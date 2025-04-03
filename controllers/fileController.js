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
    'content-length',
    // Load balancer and proxy headers
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-forwarded-host',
    'x-forwarded-path',
    'x-forwarded-prefix',
    'x-real-ip',
    'x-amzn-trace-id',
    'x-amz-cf-id',
    'cdn-loop',
    'via',
    'true-client-ip',
    'x-correlation-id',
    'forwarded'
];

const allowedHeadersGet = [
    'cache-control',
    'postman-token',
    'host',
    'user-agent',
    'accept',
    'accept-encoding',
    'connection',
    // Load balancer and proxy headers
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-forwarded-host',
    'x-forwarded-path',
    'x-forwarded-prefix',
    'x-real-ip',
    'x-amzn-trace-id',
    'x-amz-cf-id',
    'cdn-loop',
    'via',
    'true-client-ip',
    'x-correlation-id',
    'forwarded'
];

// Configure AWS S3
const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1'
});

// Debug log S3 configuration
logger.debug('S3 client initialized', {
    region: process.env.S3_REGION || 'us-east-1',
    bucketConfigured: !!process.env.S3_BUCKET
});

// Custom file filter function to check for multiple files
const fileFilter = (req, file, cb) => {
    // Debug log received file
    logger.debug('File received in upload request', {
        requestId: req.id || 'no-id-yet',
        filename: file.originalname,
        mimetype: file.mimetype,
        fieldname: file.fieldname,
        size: file.size
    });

    // Check if there's already a file being processed
    if (req.multiFileAttempt) {
        // Signal that multiple files were attempted
        req.multipleFilesAttempted = true;
        logger.debug('Multiple file upload attempt detected', {
            requestId: req.id || 'no-id-yet',
            currentFile: file.originalname
        });
        return cb(null, false);
    }

    // Mark that we've seen a file
    req.multiFileAttempt = true;
    logger.debug('File accepted for processing', {
        requestId: req.id || 'no-id-yet',
        filename: file.originalname
    });

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
    logger.debug('Multiple file check passed', {
        requestId: req.id || 'no-id-yet'
    });
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

    // Debug log request details
    logger.debug('File upload request details', {
        requestId,
        contentType: req.headers['content-type'],
        contentLength: req.headers['content-length'],
        hasFile: !!req.file,
        fileSize: req.file ? req.file.size : 0,
        hostname: req.headers.host,
        path: req.path,
        method: req.method
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

        // Debug log S3 upload parameters
        logger.debug('S3 upload parameters', {
            requestId,
            bucketName,
            key,
            contentType: req.file.mimetype,
            userId,
            bufferSize: req.file.buffer.length
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
                logger.debug('Starting S3 PutObject operation', {
                    requestId,
                    key,
                    timestamp: new Date().toISOString()
                });
                await s3Client.send(new PutObjectCommand(uploadParams));
                logger.debug('S3 PutObject operation completed', {
                    requestId,
                    key,
                    timestamp: new Date().toISOString()
                });
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

            // Debug log more detailed S3 error information
            logger.debug('Detailed S3 upload error', {
                requestId,
                errorName: s3Error.name,
                errorStack: s3Error.stack?.split('\n').slice(0, 5).join('\n'),
                errorRequestId: s3Error.$metadata?.requestId,
                errorHttpStatusCode: s3Error.$metadata?.httpStatusCode,
                errorHeaders: JSON.stringify(s3Error.$metadata?.cfId || {})
            });

            res.status(503);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        // Save file metadata to database
        try {
            // Debug log before database operation
            logger.debug('Attempting to save file metadata to database', {
                requestId,
                fileId,
                fileName,
                url: `${bucketName}/${key}`,
                timestamp: new Date().toISOString()
            });

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

            // Debug log response details
            logger.debug('Sending successful upload response', {
                requestId,
                responseStatus: 201,
                responseBody: JSON.stringify(response)
            });

            res.status(201).json(response);
            logger.info('File upload completed successfully', {
                requestId,
                responseStatus: 201
            });
            metrics.safelyStopTimer(apiTimer);
            return;
        } catch (dbError) {
            // Debug log database error details
            logger.debug('Detailed database error', {
                requestId,
                errorName: dbError.name,
                errorMessage: dbError.message,
                errorStack: dbError.stack?.split('\n').slice(0, 5).join('\n'),
                sqlState: dbError.sqlState,
                sqlErrorCode: dbError.original?.code,
                sqlMessage: dbError.original?.sqlMessage
            });

            // If RDS is down, cleanup the S3 object
            if (s3UploadSuccess) {
                try {
                    logger.debug('Attempting to clean up S3 object after database error', {
                        requestId,
                        key,
                        bucketName,
                        timestamp: new Date().toISOString()
                    });

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

                    // Debug log detailed S3 cleanup error
                    logger.debug('Detailed S3 cleanup error', {
                        requestId,
                        errorName: cleanupError.name,
                        errorStack: cleanupError.stack?.split('\n').slice(0, 5).join('\n'),
                        errorRequestId: cleanupError.$metadata?.requestId,
                        errorHttpStatusCode: cleanupError.$metadata?.httpStatusCode
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

        // Debug log more comprehensive error information
        logger.debug('Comprehensive error details', {
            requestId,
            errorName: error.name,
            errorCode: error.code,
            errorStack: error.stack,
            timestamp: new Date().toISOString(),
            requestPath: req.path,
            requestMethod: req.method,
            requestHeaders: JSON.stringify(req.headers)
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

    // Debug log request details
    logger.debug('Get file request details', {
        requestId,
        fileId: req.params.id,
        path: req.path,
        method: req.method,
        headers: JSON.stringify(req.headers),
        timestamp: new Date().toISOString()
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

        // Debug log before database query
        logger.debug('Looking up file in database', {
            requestId,
            fileId,
            timestamp: new Date().toISOString(),
            operation: 'findByPk'
        });

        // Find the file in database
        const fileRecord = await metrics.trackDbQuery('findByPk', 'File', async () => {
            return await File.findByPk(fileId);
        });

        if (!fileRecord) {
            logger.warn('File not found', { requestId, fileId });

            // Debug log file not found details
            logger.debug('File lookup returned no results', {
                requestId,
                fileId,
                timestamp: new Date().toISOString(),
                lookupMethod: 'findByPk'
            });

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

        // Debug log file found details
        logger.debug('File lookup details', {
            requestId,
            fileId,
            fileName: fileRecord.file_name,
            url: fileRecord.url,
            uploadDate: fileRecord.upload_date,
            timestamp: new Date().toISOString()
        });

        // Return file metadata
        const response = {
            file_name: fileRecord.file_name,
            id: fileRecord.id,
            url: fileRecord.url,
            upload_date: fileRecord.upload_date
        };

        // Debug log response
        logger.debug('Sending successful get file response', {
            requestId,
            responseStatus: 200,
            responseBody: JSON.stringify(response)
        });

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

        // Debug log detailed error
        logger.debug('Detailed error retrieving file', {
            requestId,
            fileId: req.params.id,
            errorName: error.name,
            errorCode: error.code,
            errorStack: error.stack,
            sqlState: error.sqlState,
            sqlErrorCode: error.original?.code,
            sqlMessage: error.original?.sqlMessage
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

    // Debug log request details
    logger.debug('Delete file request details', {
        requestId,
        fileId: req.params.id,
        path: req.path,
        method: req.method,
        headers: JSON.stringify(req.headers),
        timestamp: new Date().toISOString()
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

        // Debug log before database query
        logger.debug('Looking up file for deletion', {
            requestId,
            fileId,
            timestamp: new Date().toISOString(),
            operation: 'findByPk'
        });

        // Find the file in database
        const fileRecord = await metrics.trackDbQuery('findByPk', 'File', async () => {
            return await File.findByPk(fileId);
        });

        if (!fileRecord) {
            logger.warn('File not found for deletion', { requestId, fileId });

            // Debug log file not found for deletion
            logger.debug('File not found for deletion - details', {
                requestId,
                fileId,
                timestamp: new Date().toISOString(),
                operation: 'findByPk',
                result: 'null'
            });

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

        // Debug log S3 deletion parameters
        logger.debug('S3 deletion parameters', {
            requestId,
            bucketName,
            key,
            fileId,
            fileName: fileRecord.file_name,
            timestamp: new Date().toISOString()
        });

        // Delete file from S3
        try {
            await metrics.trackS3Operation('DeleteObject', async () => {
                logger.debug('Starting S3 DeleteObject operation', {
                    requestId,
                    key,
                    bucketName,
                    timestamp: new Date().toISOString()
                });

                await s3Client.send(new DeleteObjectCommand({
                    Bucket: bucketName,
                    Key: key
                }));

                logger.debug('S3 DeleteObject operation completed', {
                    requestId,
                    key,
                    bucketName,
                    timestamp: new Date().toISOString()
                });
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

            // Debug log more detailed S3 error information
            logger.debug('Detailed S3 deletion error', {
                requestId,
                errorName: s3Error.name,
                errorStack: s3Error.stack?.split('\n').slice(0, 5).join('\n'),
                errorRequestId: s3Error.$metadata?.requestId,
                errorHttpStatusCode: s3Error.$metadata?.httpStatusCode,
                timestamp: new Date().toISOString()
            });

            res.status(500);
            res.set('Content-Length', '0');
            metrics.safelyStopTimer(apiTimer);
            return res.end();
        }

        // Debug log before database delete operation
        logger.debug('Attempting to delete file metadata from database', {
            requestId,
            fileId,
            timestamp: new Date().toISOString()
        });

        // Delete file record from database
        await metrics.trackDbQuery('destroy', 'File', async () => {
            await fileRecord.destroy();
        });

        logger.info('File metadata deleted from database', { requestId, fileId });

        // Debug log after database deletion
        logger.debug('Database record deletion completed', {
            requestId,
            fileId,
            timestamp: new Date().toISOString()
        });

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

        // Debug log comprehensive error details
        logger.debug('Comprehensive error details for file deletion', {
            requestId,
            fileId: req.params.id,
            errorName: error.name,
            errorCode: error.code,
            errorStack: error.stack,
            timestamp: new Date().toISOString(),
            sqlState: error.sqlState,
            sqlErrorCode: error.original?.code,
            sqlMessage: error.original?.sqlMessage
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