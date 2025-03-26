const File = require('../models/File');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

//Allowed headers for /file
const allowedHeadersPost = [
    'cache-control',
    'postman-token',
    'host',
    'user-agent',
    'accept',
    'accept-encoding',
    'connection',
    'content-type',
    'content-length'
];

const allowedHeadersGet = [
    'cache-control',
    'postman-token',
    'host',
    'user-agent',
    'accept',
    'accept-encoding',
    'connection'
];

// Configure AWS S3
const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1'
});

// Custom file filter function to check for multiple files
const fileFilter = (req, file, cb) => {
    // Check if there's already a file being processed
    if (req.multiFileAttempt) {
        // Signal that multiple files were attempted
        req.multipleFilesAttempted = true;
        return cb(null, false);
    }

    // Mark that we've seen a file
    req.multiFileAttempt = true;

    // Accept the file
    cb(null, true);
};

// Configure Multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    },
    fileFilter: fileFilter
});

// Middleware to check for multiple files
const checkMultipleFiles = (req, res, next) => {
    if (req.multipleFilesAttempted) {
        logger.warn('Multiple files attempted for upload', {
            path: req.path,
            method: req.method,
            requestId: req.id
        });
        res.status(400);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
};

// Controller function to upload a file
const uploadFile = async (req, res) => {
    const requestId = uuidv4();
    req.id = requestId;

    // Start API timing
    const apiTimer = metrics.createTimer('api.upload_file.time');

    // Increment API counter
    metrics.incrementCounter('api.upload_file.count');

    logger.info('File upload request received', {
        requestId,
        contentType: req.headers['content-type'],
        hasFile: !!req.file
    });

    // Validate headers
    const uploadIncomingHeaders = Object.keys(req.headers);
    const uploadInvalidHeaders = uploadIncomingHeaders.filter(
        (header) => !allowedHeadersPost.includes(header.toLowerCase())
    );

    if (uploadInvalidHeaders.length > 0) {
        logger.warn('Invalid headers in upload request', {
            requestId,
            invalidHeaders: uploadInvalidHeaders
        });
        res.status(400);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }

    try {
        if (!req.file) {
            logger.warn('No file in upload request', { requestId });
            res.status(400);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        const fileId = uuidv4();
        const fileName = req.file.originalname;
        const bucketName = process.env.S3_BUCKET;
        const userId = req.user?.id || 'default-user'; // This would come from authentication
        const key = `${userId}/${fileId}-${fileName}`;

        logger.info('Preparing to upload file to S3', {
            requestId,
            fileId,
            fileName,
            mimeType: req.file.mimetype,
            size: req.file.size
        });

        // Upload file to S3
        const uploadParams = {
            Bucket: bucketName,
            Key: key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        };

        let s3UploadSuccess = false;

        try {
            // Use metrics to time S3 operation
            await metrics.trackS3Operation('PutObject', async () => {
                await s3Client.send(new PutObjectCommand(uploadParams));
            });

            s3UploadSuccess = true;
            logger.info('File uploaded to S3 successfully', { requestId, fileId, key });
        } catch (s3Error) {
            logger.error('S3 upload error', {
                requestId,
                error: s3Error.message,
                code: s3Error.code,
                bucketName,
                key
            });
            res.status(503);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        // Save file metadata to database
        try {
            // Use metrics to time database operation
            const fileRecord = await metrics.trackDbQuery('create', 'File', async () => {
                return await File.create({
                    id: fileId,
                    file_name: fileName,
                    url: `${bucketName}/${key}`,
                    upload_date: new Date().toISOString().split('T')[0]
                });
            });

            logger.info('File metadata saved to database', {
                requestId,
                fileId: fileRecord.id,
                fileName: fileRecord.file_name
            });

            // Return success response
            const response = {
                file_name: fileRecord.file_name,
                id: fileRecord.id,
                url: fileRecord.url,
                upload_date: fileRecord.upload_date
            };

            res.status(201).json(response);
            logger.info('File upload completed successfully', {
                requestId,
                responseStatus: 201
            });
            metrics.safelyStopTimer(apiTimer);
            return;
        } catch (dbError) {
            // If RDS is down, cleanup the S3 object
            if (s3UploadSuccess) {
                try {
                    await metrics.trackS3Operation('DeleteObject', async () => {
                        await s3Client.send(new DeleteObjectCommand({
                            Bucket: bucketName,
                            Key: key
                        }));
                    });

                    logger.info(`Cleaned up S3 object due to database error`, {
                        requestId,
                        key,
                        bucketName
                    });
                } catch (cleanupError) {
                    logger.error('Failed to clean up S3 object after database error', {
                        requestId,
                        error: cleanupError.message,
                        originalError: dbError.message,
                        key,
                        bucketName
                    });
                }
            }
            logger.error('Database error when saving file metadata', {
                requestId,
                error: dbError.message,
                dbErrorStack: dbError.stack?.split('\n').slice(0, 3).join('\n')
            });
            res.status(503);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }
    } catch (error) {
        logger.error('Unexpected error uploading file', {
            requestId,
            error: error.message,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        res.status(503);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }
};

// Controller function to get file by ID
const getFileById = async (req, res) => {
    const requestId = uuidv4();
    req.id = requestId;

    // Start API timing
    const apiTimer = metrics.createTimer('api.get_file.time');

    // Increment API counter
    metrics.incrementCounter('api.get_file.count');

    logger.info('Get file request received', {
        requestId,
        fileId: req.params.id
    });

    // Validate headers
    const getIncomingHeaders = Object.keys(req.headers);
    const getInvalidHeaders = getIncomingHeaders.filter(
        (header) => !allowedHeadersGet.includes(header.toLowerCase())
    );

    if (getInvalidHeaders.length > 0) {
        logger.warn('Invalid headers in get file request', {
            requestId,
            fileId: req.params.id,
            invalidHeaders: getInvalidHeaders
        });
        res.status(400);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }

    try {
        // Check for body, content-type, files and query params
        if (
            // Checks for JSON or x-www-form-urlencoded body
            Object.keys(req.body).length > 0 ||
            // Detect content-type header for any kind of body
            req.headers['content-type'] ||
            // Check for form-data with files
            (req.files && req.files.length > 0) ||
            // Checks for any query
            Object.keys(req.query).length > 0
        ) {
            logger.warn('Invalid request format for get file', {
                requestId,
                fileId: req.params.id,
                hasBody: Object.keys(req.body).length > 0,
                hasContentType: !!req.headers['content-type'],
                hasFiles: !!(req.files && req.files.length > 0),
                hasQuery: Object.keys(req.query).length > 0
            });
            res.status(400);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }
        const fileId = req.params.id;

        // Find the file in database
        const fileRecord = await metrics.trackDbQuery('findByPk', 'File', async () => {
            return await File.findByPk(fileId);
        });

        if (!fileRecord) {
            logger.warn('File not found', { requestId, fileId });
            res.status(404);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        logger.info('File found', {
            requestId,
            fileId,
            fileName: fileRecord.file_name
        });

        // Return file metadata
        const response = {
            file_name: fileRecord.file_name,
            id: fileRecord.id,
            url: fileRecord.url,
            upload_date: fileRecord.upload_date
        };

        res.status(200).json(response);
        logger.info('Get file completed successfully', {
            requestId,
            responseStatus: 200
        });
        metrics.safelyStopTimer(apiTimer);
        return;
    } catch (error) {
        logger.error('Error retrieving file', {
            requestId,
            fileId: req.params.id,
            error: error.message,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        res.status(503);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }
};

// Controller function to delete file by ID
const deleteFileById = async (req, res) => {
    const requestId = uuidv4();
    req.id = requestId;

    // Start API timing
    const apiTimer = metrics.createTimer('api.delete_file.time');

    // Increment API counter
    metrics.incrementCounter('api.delete_file.count');

    logger.info('Delete file request received', {
        requestId,
        fileId: req.params.id
    });

    // Validate headers
    const deleteIncomingHeaders = Object.keys(req.headers);
    const deleteInvalidHeaders = deleteIncomingHeaders.filter(
        (header) => !allowedHeadersGet.includes(header.toLowerCase())
    );

    if (deleteInvalidHeaders.length > 0) {
        logger.warn('Invalid headers in delete file request', {
            requestId,
            fileId: req.params.id,
            invalidHeaders: deleteInvalidHeaders
        });
        res.status(400);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }

    try {
        // Check for body, content-type, files and query params
        if (
            // Checks for JSON or x-www-form-urlencoded body
            Object.keys(req.body).length > 0 ||
            // Detect content-type header for any kind of body
            req.headers['content-type'] ||
            // Check for form-data with files
            (req.files && req.files.length > 0) ||
            // Checks for any query
            Object.keys(req.query).length > 0
        ) {
            logger.warn('Invalid request format for delete file', {
                requestId,
                fileId: req.params.id,
                hasBody: Object.keys(req.body).length > 0,
                hasContentType: !!req.headers['content-type'],
                hasFiles: !!(req.files && req.files.length > 0),
                hasQuery: Object.keys(req.query).length > 0
            });
            res.status(400);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }
        const fileId = req.params.id;

        // Find the file in database
        const fileRecord = await metrics.trackDbQuery('findByPk', 'File', async () => {
            return await File.findByPk(fileId);
        });

        if (!fileRecord) {
            logger.warn('File not found for deletion', { requestId, fileId });
            res.status(404);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        // Extract the key from the URL
        const url = fileRecord.url;
        const bucketName = process.env.S3_BUCKET;

        // Parse the URL to get the key
        // URL format is likely: bucketName/userId/fileId-filename
        const urlParts = url.split('/');
        // Remove the bucket name from the parts and join the rest to form the key
        const key = urlParts.slice(1).join('/');

        logger.info('Preparing to delete file from S3', {
            requestId,
            fileId,
            fileName: fileRecord.file_name,
            key
        });

        // Delete file from S3
        try {
            await metrics.trackS3Operation('DeleteObject', async () => {
                await s3Client.send(new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: key
                }));
            });

            logger.info('File deleted from S3', { requestId, key });
        } catch (s3Error) {
            logger.error('S3 deletion error', {
                requestId,
                error: s3Error.message,
                code: s3Error.code,
                bucketName,
                key
            });
            res.status(500);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        // Delete file record from database
        await metrics.trackDbQuery('destroy', 'File', async () => {
            await fileRecord.destroy();
        });

        logger.info('File metadata deleted from database', { requestId, fileId });

        // Return success response with no content
        res.status(204);
        res.set('Content-Length', '0');
        logger.info('Delete file completed successfully', {
            requestId,
            responseStatus: 204
        });
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    } catch (error) {
        logger.error('Error deleting file', {
            requestId,
            fileId: req.params.id,
            error: error.message,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        res.status(503);
        res.set('Content-Length', '0');
        metrics.safelyStopTimer(apiTimer);
        return res.end();
    }
};

module.exports = {
    upload,
    checkMultipleFiles,
    uploadFile,
    getFileById,
    deleteFileById
};