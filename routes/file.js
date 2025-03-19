const express = require('express');
const router = express.Router();
const { upload, uploadFile, getFileById, deleteFileById } = require('../controllers/fileController');

// POST /v1/file - Upload a file
router.post('/file', upload.single('profilePic'), uploadFile);

// GET /v1/file/:id - Get file by ID
router.get('/file/:id', getFileById);

// DELETE /v1/file/:id - Delete file by ID
router.delete('/file/:id', deleteFileById);

module.exports = router;