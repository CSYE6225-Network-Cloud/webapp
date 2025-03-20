const File = require('../models/File');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

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
        return res.status(400).json({ error: 'Multiple files detected. Only one file upload is allowed.' });
    }
    next();
};

// Controller function to upload a file
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).end();
        }

        const fileId = uuidv4();
        const fileName = req.file.originalname;
        const bucketName = process.env.S3_BUCKET;
        const userId = req.user?.id || 'default-user'; // This would come from authentication
        const key = `${userId}/${fileId}-${fileName}`;

        // Upload file to S3
        const uploadParams = {
            Bucket: bucketName,
            Key: key,
            Body: req.file.buffer,
            ContentType: req.file.mimetype
        };

        try {
            await s3Client.send(new PutObjectCommand(uploadParams));
        } catch (s3Error) {
            console.error('S3 upload error:', s3Error);
            return res.status(500).end();
        }

        // Save file metadata to database
        const fileRecord = await File.create({
            id: fileId,
            file_name: fileName,
            url: `${bucketName}/${key}`, // Store the full path for consistent retrieval/deletion
            upload_date: new Date().toISOString().split('T')[0] // Format: YYYY-MM-DD
        });

        // Return success response
        return res.status(201).json({
            file_name: fileRecord.file_name,
            id: fileRecord.id,
            url: fileRecord.url,
            upload_date: fileRecord.upload_date
        });
    } catch (error) {
        console.error('Error uploading file:', error);
        return res.status(500).end();
    }
};

// Controller function to get file by ID
const getFileById = async (req, res) => {
    try {
        if (
            // Checks for JSON or x-www-form-urlencoded body
            Object.keys(req.body).length > 0 ||
            // Detect content-type header for any kind of body
            req.headers['content-type'] ||
            // Check for form-data with files
            (req.files && req.files.length > 0) ||
            // Checks for any query
            Object.keys(req.query).length > 0 ||
            //Checks for invalid headers
            invalidHeaders.length > 0
        ) {
            return res.status(400).end();
        }
        const fileId = req.params.id;

        // Find the file in database
        const fileRecord = await File.findByPk(fileId);

        if (!fileRecord) {
            return res.status(404).end();
        }

        // Return file metadata
        return res.status(200).json({
            file_name: fileRecord.file_name,
            id: fileRecord.id,
            url: fileRecord.url,
            upload_date: fileRecord.upload_date
        });
    } catch (error) {
        console.error('Error retrieving file:', error);
        return res.status(500).end();
    }
};

// Controller function to delete file by ID
const deleteFileById = async (req, res) => {
    try {
        if (
            // Checks for JSON or x-www-form-urlencoded body
            Object.keys(req.body).length > 0 ||
            // Detect content-type header for any kind of body
            req.headers['content-type'] ||
            // Check for form-data with files
            (req.files && req.files.length > 0) ||
            // Checks for any query
            Object.keys(req.query).length > 0 ||
            //Checks for invalid headers
            invalidHeaders.length > 0
        ) {
            return res.status(400).end();
        }
        const fileId = req.params.id;

        // Find the file in database
        const fileRecord = await File.findByPk(fileId);

        if (!fileRecord) {
            return res.status(404).end();
        }

        // Extract the key from the URL
        const url = fileRecord.url;
        const bucketName = process.env.S3_BUCKET;

        // Parse the URL to get the key
        // URL format is likely: bucketName/userId/fileId-filename
        const urlParts = url.split('/');
        // Remove the bucket name from the parts and join the rest to form the key
        const key = urlParts.slice(1).join('/');

        // Delete file from S3
        try {
            await s3Client.send(new DeleteObjectCommand({
                Bucket: bucketName,
                Key: key
            }));
        } catch (s3Error) {
            console.error('S3 deletion error:', s3Error);
            return res.status(500).end();
        }

        // Delete file record from database
        await fileRecord.destroy();

        // Return success response with no content
        return res.status(204).end();
    } catch (error) {
        console.error('Error deleting file:', error);
        return res.status(500).end();
    }
};

module.exports = {
    upload,
    checkMultipleFiles,
    uploadFile,
    getFileById,
    deleteFileById
};