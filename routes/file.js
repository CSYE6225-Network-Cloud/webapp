const express = require('express');
const router = express.Router();
const { upload, checkMultipleFiles, uploadFile, getFileById, deleteFileById } = require('../controllers/fileController');

// Middleware to restrict HTTP methods
const methodNotAllowedMiddleware = (req, res) => {
    return res.status(405).end();
};

// POST /v1/file - Upload a file with multiple file check
router.post('/file', upload.single('file'), checkMultipleFiles, uploadFile);

// GET /v1/file/:id - Get file by ID
router.get('/file/:id', getFileById);

// DELETE /v1/file/:id - Delete file by ID
router.delete('/file/:id', deleteFileById);

// Handle unsupported methods for /v1/file
router.head('/file', methodNotAllowedMiddleware);
router.options('/file', methodNotAllowedMiddleware);
router.patch('/file', methodNotAllowedMiddleware);
router.put('/file', methodNotAllowedMiddleware);

// Handle unsupported methods for /v1/file/:id
router.head('/file/:id', methodNotAllowedMiddleware);
router.options('/file/:id', methodNotAllowedMiddleware);
router.patch('/file/:id', methodNotAllowedMiddleware);
router.put('/file/:id', methodNotAllowedMiddleware);
router.post('/file/:id', methodNotAllowedMiddleware);

module.exports = router;