const HealthCheck = require('../models/HealthCheck');
const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const metrics = require('../utils/metrics');

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
    const requestId = uuidv4();
    req.id = requestId;

    // Start API timing
    const apiTimer = metrics.startTimer('api.healthz.time', {
        method: req.method,
        path: '/healthz'
    });

    // Increment API counter
    metrics.incrementCounter('api.healthz.count', {
        method: req.method,
        path: '/healthz'
    });

    logger.info('Health check request received', { requestId, method: req.method });

    if (req.method === "HEAD") {
        logger.warn('HEAD method not allowed for health check', { requestId });
        apiTimer.end();
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
        logger.warn('Invalid request format for health check', {
            requestId,
            hasBody: Object.keys(req.body).length > 0,
            hasContentType: !!req.headers['content-type'],
            hasFiles: !!(req.files && req.files.length > 0),
            hasQuery: Object.keys(req.query).length > 0,
            invalidHeaders: invalidHeaders.length > 0 ? invalidHeaders : undefined
        });
        apiTimer.end();
        return res.status(400).end();
    }

    // Insert a new record in the HealthCheck table
    try {
        await metrics.timeOperation(
            'db.create_record.time',
            async () => {
                await HealthCheck.create();
            },
            { requestId, operation: 'create', model: 'HealthCheck' }
        );

        logger.info('Health check successful', { requestId, responseStatus: 200 });
        apiTimer.end();
        return res.status(200).end();
    } catch (error) {
        logger.error('Health check failed', {
            requestId,
            error: error.message,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        apiTimer.end();
        return res.status(503).end();
    }
};

module.exports = { performHealthCheck };