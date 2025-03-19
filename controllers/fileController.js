const File = require('../models/File');
const multer = require('multer');
const { S3Client, PutObjectCommand, GetObjectCommand } = require('@aws-sdk/client-s3');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');

// Configure AWS S3
const s3Client = new S3Client({
    region: process.env.S3_REGION || 'us-east-1'
});

// Configure Multer for file upload
const storage = multer.memoryStorage();
const upload = multer({
    storage: storage,
    limits: {
        fileSize: 5 * 1024 * 1024, // 5MB limit
    }
});

// Controller function to upload a file
const uploadFile = async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
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

        await s3Client.send(new PutObjectCommand(uploadParams));

        // Save file metadata to database
        const fileRecord = await File.create({
            id: fileId,
            file_name: fileName,
            url: `${bucketName}/${key}`,
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
        return res.status(500).json({ error: 'Failed to upload file' });
    }
};

// Controller function to get file by ID
const getFileById = async (req, res) => {
    try {
        const fileId = req.params.id;

        // Find the file in database
        const fileRecord = await File.findByPk(fileId);

        if (!fileRecord) {
            return res.status(404).json({ error: 'File not found' });
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
        return res.status(500).json({ error: 'Failed to retrieve file information' });
    }
};

module.exports = {
    upload,
    uploadFile,
    getFileById
};