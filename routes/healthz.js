const express = require('express');
const router = express.Router();
const { performHealthCheck } = require('../controllers/healthzController');

// Define the /healthz route
router.get('/healthz', performHealthCheck);

// Handle unsupported HTTP methods for /healthz
router.all('/healthz', (req, res) => {
    res.status(405).send(); // Method Not Allowed
});

module.exports = router;
