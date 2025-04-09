const express = require('express');
const router = express.Router();
const { performHealthCheck } = require('../controllers/healthzController');

// This will handle requests to /healthz because of how we mounted the router in server.js
router.get('/healthz',performHealthCheck);
router.get('/cicd',performHealthCheck);

// Handle unsupported HTTP methods for health check
router.all('/healthz', (req, res) => {
    // Method Not Allowed
    res.status(405).send();
});

// Handle unsupported HTTP methods for health check
router.all('/cicd', (req, res) => {
    // Method Not Allowed
    res.status(405).send();
});
module.exports = router;