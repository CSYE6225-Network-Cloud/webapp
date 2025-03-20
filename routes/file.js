const express = require('express');
const router = express.Router();
const { upload, checkMultipleFiles, uploadFile, getFileById, deleteFileById } = require('../controllers/fileController');

// Middleware to restrict HTTP methods
const methodNotAllowedMiddleware = (req, res) => {
    res.status(405);
    res.set('Content-Length', '0');
    return res.end();
};

// POST /v1/file - Upload a file with multiple file check
router.post('/file', upload.single('file'), checkMultipleFiles, uploadFile);

// GET /v1/file/:id - Get file by ID
router.get('/file/:id', getFileById);

// DELETE /v1/file/:id - Delete file by ID
router.delete('/file/:id', deleteFileById);

// Handle all unsupported methods
router.all('/file', methodNotAllowedMiddleware);
router.all('/file/:id', methodNotAllowedMiddleware);

module.exports = router;