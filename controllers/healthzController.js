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
    // Load balancer and proxy headers
    'x-forwarded-for',
    'x-forwarded-proto',
    'x-forwarded-port',
    'x-forwarded-host',
    'x-forwarded-path',
    'x-forwarded-prefix',
    'x-real-ip',
    'x-amzn-trace-id',
    'x-amz-cf-id',
    'cdn-loop',
    'via',
    'true-client-ip',
    'x-correlation-id',
    'forwarded'
];

// Debug log allowed headers on module initialization
logger.debug('HealthCheck controller initialized with allowed headers', {
    allowedHeadersCount: allowedHeaders.length,
    firstFewHeaders: allowedHeaders.slice(0, 5).join(', ')
});

// Controller function for /healthz
const performHealthCheck = async (req, res) => {
    const requestId = uuidv4();
    req.id = requestId;

    // Start API timing - using createTimer instead of startTimer
    const apiTimer = metrics.createTimer('api.healthz.time');

    // Increment API counter
    metrics.incrementCounter('api.healthz.count');

    logger.info('Health check request received', { requestId, method: req.method });

    // Debug log request details
    logger.debug('Health check request details', {
        requestId,
        method: req.method,
        path: req.path,
        ip: req.ip,
        timestamp: new Date().toISOString(),
        userAgent: req.headers['user-agent'],
        headers: JSON.stringify(req.headers)
    });

    if (req.method === "HEAD") {
        logger.warn('HEAD method not allowed for health check', { requestId });

        // Debug log method rejection
        logger.debug('Rejecting HEAD request for health check', {
            requestId,
            method: req.method,
            timestamp: new Date().toISOString(),
            responseStatus: 405
        });

        metrics.safelyStopTimer(apiTimer); // Use safelyStopTimer instead of timer.end()
        return res.status(405).end();
    }

    //Set headers
    res.set("Cache-Control","no-cache, no-store, must-revalidate;");
    res.set("Pragma","no-cache");
    res.set("X-Content-Type-Options","nosniff");
    res.set('Connection', 'close');

    // Debug log response headers being set
    logger.debug('Setting health check response headers', {
        requestId,
        headers: {
            'Cache-Control': 'no-cache, no-store, must-revalidate;',
            'Pragma': 'no-cache',
            'X-Content-Type-Options': 'nosniff',
            'Connection': 'close'
        }
    });

    const incomingHeaders = Object.keys(req.headers);
    const invalidHeaders = incomingHeaders.filter(
        (header) => !allowedHeaders.includes(header.toLowerCase())
    );

    // Debug log headers validation
    logger.debug('Validating request headers', {
        requestId,
        incomingHeadersCount: incomingHeaders.length,
        validHeadersCount: incomingHeaders.length - invalidHeaders.length,
        invalidHeadersCount: invalidHeaders.length,
        invalidHeaders: invalidHeaders.length > 0 ? invalidHeaders : undefined
    });

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

        // Debug log rejected request details
        logger.debug('Rejected health check request details', {
            requestId,
            bodyKeys: Object.keys(req.body).length > 0 ? Object.keys(req.body) : [],
            contentType: req.headers['content-type'],
            queryKeys: Object.keys(req.query).length > 0 ? Object.keys(req.query) : [],
            timestamp: new Date().toISOString(),
            responseStatus: 400
        });

        metrics.safelyStopTimer(apiTimer); // Use safelyStopTimer instead of timer.end()
        return res.status(400).end();
    }

    // Insert a new record in the HealthCheck table
    try {
        // Debug log before database operation
        logger.debug('Attempting to create health check record in database', {
            requestId,
            timestamp: new Date().toISOString(),
            model: 'HealthCheck',
            operation: 'create'
        });

        // Using trackDbQuery instead of timeOperation
        await metrics.trackDbQuery('create', 'HealthCheck', async () => {
            await HealthCheck.create();
        });

        // Debug log after successful database operation
        logger.debug('Successfully created health check record', {
            requestId,
            timestamp: new Date().toISOString(),
            operationSuccess: true
        });

        logger.info('Health check successful', { requestId, responseStatus: 200 });
        metrics.safelyStopTimer(apiTimer); // Use safelyStopTimer instead of timer.end()
        return res.status(200).end();
    } catch (error) {
        logger.error('Health check failed', {
            requestId,
            error: error.message,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });

        // Debug log detailed error information
        logger.debug('Detailed health check error', {
            requestId,
            errorName: error.name,
            errorCode: error.code,
            errorStack: error.stack,
            sqlState: error.sqlState,
            sqlErrorCode: error.original?.code,
            sqlMessage: error.original?.sqlMessage,
            timestamp: new Date().toISOString(),
            responseStatus: 503
        });

        metrics.safelyStopTimer(apiTimer); // Use safelyStopTimer instead of timer.end()
        return res.status(503).end();
    }
};

module.exports = { performHealthCheck };