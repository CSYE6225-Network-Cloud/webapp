const HealthCheck = require('../models/HealthCheck');

const allowedHeaders = [
    'cache-control',
    'postman-token',
    'host',
    'user-agent',
    'accept',
    'accept-encoding',
    'connection',
];

// Controller function for /healthz
const performHealthCheck = async (req, res) => {
    if (req.method === "HEAD") {
        return res.status(405).end();
    }
    //Set headers
    res.set("Cache-Control","no-cache, no-store, must-revalidate;");
    res.set("Pragma","no-cache");
    res.set("X-Content-Type-Options","nosniff");
    res.set('Connection', 'close');

    const incomingHeaders = Object.keys(req.headers);
    const invalidHeaders = incomingHeaders.filter(
        (header) => !allowedHeaders.includes(header.toLowerCase())
    );

    // Reject requests with payload
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
    // Insert a new record in the  HealthCheck table
    try {
        await HealthCheck.create();
        return res.status(200).end();
    } catch (error) {
        console.error('Health check failed:', error);
        return res.status(503).end();
    }
};

module.exports = { performHealthCheck };
