const express = require('express');
const dotenv = require('dotenv');
const { v4: uuidv4 } = require('uuid');
const { sequelize, createDatabaseIfNotExists } = require('./db.js');
const healthzRoutes = require('./routes/healthz.js');
const fileRoutes = require('./routes/file.js');
const logger = require('./utils/logger');
const metrics = require('./utils/metrics');

// Load environment variables
dotenv.config();

const app = express();
app.disable('x-powered-by');
const PORT = process.env.PORT || 8080;

// Request logging middleware
app.use((req, res, next) => {
    // Assign a unique ID to each request if not already assigned
    req.id = req.id || uuidv4();

    // Log request details
    logger.info('Incoming request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.get('user-agent')
    });

    // Start tracking response time
    const startTime = Date.now();

    // Override end method to capture response details
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        // Calculate response time
        const responseTime = Date.now() - startTime;

        // Log response details
        logger.info('Response sent', {
            requestId: req.id,
            method: req.method,
            path: req.path,
            statusCode: res.statusCode,
            responseTime
        });

        // Track response time as a metric
        metrics.incrementCounter(`api.response.status.${res.statusCode}`);
        metrics.incrementCounter(`api.response.status.${Math.floor(res.statusCode / 100)}xx`);

        // Call the original end method
        return originalEnd.call(this, chunk, encoding);
    };

    next();
});

app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Middleware to check for request body in GET and DELETE requests - applies to all routes
app.use((req, res, next) => {
    if ((req.method === 'GET' || req.method === 'DELETE') &&
        (Object.keys(req.body).length > 0 ||
            (req.headers['content-length'] && parseInt(req.headers['content-length']) > 0))) {

        logger.warn('Body content detected in GET/DELETE request', {
            requestId: req.id,
            method: req.method,
            path: req.path,
            contentLength: req.headers['content-length']
        });

        res.status(400);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

// Global middleware to handle HEAD requests
app.use((req, res, next) => {
    if (req.method === 'HEAD') {
        logger.warn('HEAD method not allowed', {
            requestId: req.id,
            path: req.path
        });

        res.status(405);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

app.use(healthzRoutes);
app.use('/v1', fileRoutes);

// Middleware to handle unimplemented routes
app.use((req, res) => {
    logger.warn('Route not found', {
        requestId: req.id,
        method: req.method,
        path: req.path
    });

    res.status(404);
    res.set('Content-Length', '0');
    res.end();
});

// Ensure database exists before starting
const startServer = async () => {
    try {
        logger.info('Initializing database...');
        await createDatabaseIfNotExists();
        await sequelize.sync();
        logger.info('Database synchronized successfully');

        if (process.env.NODE_ENV !== 'test') {
            app.listen(PORT, () => {
                logger.info(`Server running on port ${PORT}`);
                metrics.incrementCounter('server.start');
            });
        }
    } catch (error) {
        logger.error('Failed to start server', {
            error: error.message,
            stack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        process.exit(1);
    }
};

// Handle graceful shutdown
process.on('SIGTERM', () => {
    logger.info('SIGTERM received, shutting down gracefully');
    metrics.incrementCounter('server.shutdown.sigterm');
    process.exit(0);
});

process.on('SIGINT', () => {
    logger.info('SIGINT received, shutting down gracefully');
    metrics.incrementCounter('server.shutdown.sigint');
    process.exit(0);
});

// Start the server only if not in test mode
if (process.env.NODE_ENV !== 'test') {
    startServer();
}

module.exports = app