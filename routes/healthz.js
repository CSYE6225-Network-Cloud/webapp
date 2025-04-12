const express = require('express');
const router = express.Router();
const { performHealthCheck } = require('../controllers/healthzController');

// This will handle requests to /healthz because of how we mounted the router in server.js
router.get('/healthz', performHealthCheck);
// Handle unsupported HTTP methods for health check
router.all('/healthz', (req, res) => {
    // Method Not Allowed
    res.status(405).send();
});

module.exports = router;