const express = require('express');
const dotenv = require('dotenv');
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

// Define paths to ignore in logging (health checks, etc.)
const IGNORE_LOG_PATHS = [
    '/',               // Root path (AWS health checks)
    '/favicon.ico',    // Browser favicon requests
    '/robots.txt'      // Search engine requests
];

// Request logging middleware with filtering (without request ID generation)
app.use((req, res, next) => {
    // Skip logging for health checks and other ignored paths
    const shouldLogRequest = !IGNORE_LOG_PATHS.includes(req.path);

    // Log request details (only for non-ignored paths)
    if (shouldLogRequest) {
        logger.info('Incoming request', {
            method: req.method,
            path: req.path,
            ip: req.ip,
            userAgent: req.get('user-agent')
        });
    }

    // Start tracking response time
    const startTime = Date.now();

    // Override end method to capture response details
    const originalEnd = res.end;
    res.end = function(chunk, encoding) {
        // Calculate response time
        const responseTime = Date.now() - startTime;

        // Log response details (only for non-ignored paths)
        if (shouldLogRequest) {
            logger.info('Response sent', {
                method: req.method,
                path: req.path,
                statusCode: res.statusCode,
                responseTime
            });
        }

        // Always track metrics (even for ignored paths)
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

        // Only log warnings for non-ignored paths
        if (!IGNORE_LOG_PATHS.includes(req.path)) {
            logger.warn('Body content detected in GET/DELETE request', {
                method: req.method,
                path: req.path,
                contentLength: req.headers['content-length']
            });
        }

        res.status(400);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

// Global middleware to handle HEAD requests
app.use((req, res, next) => {
    if (req.method === 'HEAD') {
        // Only log warnings for non-ignored paths
        if (!IGNORE_LOG_PATHS.includes(req.path)) {
            logger.warn('HEAD method not allowed', {
                path: req.path
            });
        }

        res.status(405);
        res.set('Content-Length', '0');
        return res.end();
    }
    next();
});

// Add a simple handler for root path to avoid 404s on health checks
app.get('/', (req, res) => {
    res.status(200);
    res.set('Content-Length', '0');
    return res.end();
});

app.use(healthzRoutes);
app.use('/v1', fileRoutes);

// Middleware to handle unimplemented routes
app.use((req, res) => {
    // Only log warnings for non-ignored paths
    if (!IGNORE_LOG_PATHS.includes(req.path)) {
        logger.warn('Route not found', {
            method: req.method,
            path: req.path
        });
    }

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

module.exports = app;