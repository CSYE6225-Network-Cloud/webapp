const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
// Use a different variable name to avoid circular reference
const metricsUtil = require('../utils/metrics');

/**
 * Middleware to track metrics for each request
 */
const trackMetrics = (req, res, next) => {
    // Generate a unique ID for this request if not already present
    req.id = req.id || uuidv4();

    // Start the request timer using createTimer instead of startTimer
    const requestTimer = metricsUtil.createTimer(`api.request.time.${req.method.toLowerCase()}`);

    // Get the original end function
    const originalEnd = res.end;

    // Override end function to record metrics before the response is sent
    res.end = function(chunk, encoding) {
        // End the timer using safelyStopTimer instead of requestTimer.end()
        metricsUtil.safelyStopTimer(requestTimer);

        // Record the response status using simple string keys instead of objects
        metricsUtil.incrementCounter(`api.response.count.${req.method.toLowerCase()}`);
        metricsUtil.incrementCounter(`api.response.status.${res.statusCode}`);
        metricsUtil.incrementCounter(`api.response.status.${Math.floor(res.statusCode / 100)}xx`);

        // Call the original end function
        return originalEnd.apply(this, arguments);
    };

    // Continue to the next middleware
    next();
};

/**
 * Add request ID to all requests
 */
const addRequestId = (req, res, next) => {
    req.id = uuidv4();
    // Add the request ID to response headers for debugging
    res.setHeader('X-Request-ID', req.id);
    next();
};

/**
 * Log all requests
 */
const logRequests = (req, res, next) => {
    // Log at the start of the request
    logger.info('Request received', {
        requestId: req.id,
        method: req.method,
        path: req.originalUrl,
        ip: req.ip,
        userAgent: req.get('user-agent')
    });

    // Get the original end function
    const originalEnd = res.end;

    // Override end function to log after the response is processed
    res.end = function(chunk, encoding) {
        // Log the response
        logger.info('Response sent', {
            requestId: req.id,
            method: req.method,
            path: req.originalUrl,
            status: res.statusCode,
            responseTime: Date.now() - req._startTime
        });

        // Call the original end function
        return originalEnd.apply(this, arguments);
    };

    // Record the start time
    req._startTime = Date.now();

    // Continue to the next middleware
    next();
};

module.exports = {
    trackMetrics,
    addRequestId,
    logRequests
};