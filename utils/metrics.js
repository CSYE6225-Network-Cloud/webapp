const StatsD = require('hot-shots');
let statsd = null;

// Initialize StatsD client if metrics are enabled
try {
    if (process.env.ENABLE_METRICS === 'true') {
        statsd = new StatsD({
            host: process.env.STATSD_HOST || 'localhost',
            port: parseInt(process.env.STATSD_PORT || '8125', 10),
            prefix: 'webapp.',  // Prefix for all metrics
            mock: false,        // Set to true for testing without a StatsD server
            globalTags: {       // Global tags to add to all metrics
                env: process.env.NODE_ENV || 'development',
                app: 'csye6225-webapp'
            },
            errorHandler: (error) => {
                console.error('StatsD error:', error);
            }
        });

        // Create simple test metrics to ensure connection works
        setTimeout(() => {
            try {
                statsd.increment('app.startup');
                console.log('StatsD test metric sent');
            } catch (err) {
                console.error('Failed to send test metric:', err);
            }
        }, 1000);

        console.log('StatsD metrics collection initialized');
    } else {
        console.log('StatsD metrics collection disabled');
    }
} catch (error) {
    console.error('Failed to initialize StatsD client:', error);
    // Make sure statsd is null so all the defensive checks work
    statsd = null;
}

/**
 * Safely increment a counter, handling cases where StatsD is not available
 * @param {string} name - The name of the metric to increment
 * @param {number} value - The value to increment by (default: 1)
 * @param {number} sampleRate - The sample rate (default: 1)
 */
function incrementCounter(name, value = 1, sampleRate = 1) {
    if (!statsd) return;

    try {
        // Sanitize the metric name to avoid invalid characters
        const safeName = name.replace(/[^a-zA-Z0-9_\.]/g, '_');

        // Ensure value is a number
        const safeValue = typeof value === 'number' ? value : 1;

        // Ensure sample rate is between 0 and 1
        const safeSampleRate = typeof sampleRate === 'number' &&
        sampleRate > 0 &&
        sampleRate <= 1 ?
            sampleRate : 1;

        statsd.increment(safeName, safeValue, safeSampleRate);
    } catch (error) {
        console.error(`Error incrementing counter ${name}:`, error);
    }
}

/**
 * Safely record timing data, handling cases where StatsD is not available
 * @param {string} name - The name of the timer metric
 * @param {number} value - The timing value in milliseconds
 */
function timing(name, value) {
    if (!statsd) return;

    try {
        // Sanitize the metric name
        const safeName = name.replace(/[^a-zA-Z0-9_\.]/g, '_');

        // Ensure value is a number and positive
        const safeValue = typeof value === 'number' && value >= 0 ? value : 0;

        statsd.timing(safeName, safeValue);
    } catch (error) {
        console.error(`Error recording timing for ${name}:`, error);
    }
}

/**
 * Create a timer that automatically records the time when stopped
 * @param {string} name - The name of the timer metric
 * @returns {Object} - Timer object with start and stop methods
 */
function createTimer(name) {
    // Ensure name is always a string
    const safeName = name ? String(name).replace(/[^a-zA-Z0-9_\.]/g, '_') : 'unknown_timer';

    // Only create a real timer if StatsD is available
    if (!statsd) {
        // Return a dummy timer with a no-op stop method to avoid null/undefined errors
        return {
            stop: () => 0,
            name: safeName
        };
    }

    const start = process.hrtime();

    return {
        stop: () => {
            try {
                const diff = process.hrtime(start);
                // Convert to milliseconds (1 second = 1e9 nanoseconds)
                const duration = (diff[0] * 1e3) + (diff[1] / 1e6);
                statsd.timing(safeName, duration);
                return duration;
            } catch (error) {
                console.error(`Error stopping timer for ${safeName}:`, error);
                return 0;
            }
        },
        name: safeName
    };
}

/**
 * Safely stop a timer, with defensive checks
 * @param {Object} timer - The timer object to stop
 * @returns {number} - The duration in milliseconds or 0 if timer is invalid
 */
function safelyStopTimer(timer) {
    try {
        if (timer && typeof timer.stop === 'function') {
            return timer.stop();
        }
    } catch (error) {
        console.error(`Error stopping timer${timer?.name ? ` for ${timer.name}` : ''}:`, error);
    }
    return 0;
}

/**
 * Middleware to track API request counts and timings
 * @param {Express.Request} req - Express request object
 * @param {Express.Response} res - Express response object
 * @param {Function} next - Express next middleware function
 */
function apiMetricsMiddleware(req, res, next) {
    try {
        // Don't process if metrics are disabled
        if (!statsd) {
            return next();
        }

        // Wait until route is resolved
        // Express sets the route property after matching the route
        const getRoutePath = () => {
            // For path parameters, try to get the route pattern
            if (req.route) {
                return req.route.path;
            }

            // Fallback: use the URL path
            return req.path || 'unknown_route';
        };

        // Clean route for metric name (handle route params)
        // This makes path parameters like /users/:id become /users/id
        const cleanRoute = (route) => {
            return route
                .replace(/\//g, '.')        // Replace slashes with dots
                .replace(/:/g, '')          // Remove colons from params
                .replace(/^\.+|\.+$/g, '')  // Remove leading/trailing dots
                .replace(/\./g, '_');       // Replace remaining dots with underscores
        };

        // Determine route path - may not be available immediately
        let routePath = getRoutePath();
        const method = req.method.toLowerCase();
        let metricBase = `api.${method}.${cleanRoute(routePath)}`;

        // Increment counter for this API endpoint
        incrementCounter(`${metricBase}.count`);

        // Create a timer for the overall request
        const apiTimer = createTimer(`${metricBase}.time`);

        // Save the original end method
        const originalEnd = res.end;

        // Override end method to record timing when the response is sent
        res.end = function(...args) {
            try {
                // Route might have been resolved by now
                if (routePath === 'unknown_route' && req.route) {
                    routePath = getRoutePath();
                    metricBase = `api.${method}.${cleanRoute(routePath)}`;
                }

                // Stop the timer (use the safe helper function)
                safelyStopTimer(apiTimer);

                // Record status code
                incrementCounter(`${metricBase}.status.${res.statusCode}`);
            } catch (error) {
                console.error('Error in metrics middleware:', error);
            }

            // Always call the original end method, even if there was an error in metrics
            return originalEnd.apply(this, args);
        };
    } catch (error) {
        console.error('Error setting up metrics middleware:', error);
    }

    // Always continue to the next middleware
    next();
}

/**
 * Track database query execution time
 * @param {string} operation - The database operation name (find, insert, update, etc.)
 * @param {string} collection - The database collection or table
 * @param {Function} queryFn - The query function to execute
 * @returns {Promise} - The result of the query function
 */
async function trackDbQuery(operation, collection, queryFn) {
    // Sanitize metric names - remove invalid characters
    const safeOperation = (operation || 'unknown').replace(/[^a-zA-Z0-9_\.]/g, '_');
    const safeCollection = (collection || 'unknown').replace(/[^a-zA-Z0-9_\.]/g, '_');

    // Create the timer with a unique name
    const timer = createTimer(`db.${safeCollection}.${safeOperation}`);

    try {
        const result = await queryFn();

        // Use the safe helper function to stop the timer
        safelyStopTimer(timer);

        return result;
    } catch (error) {
        // Use the safe helper function to stop the timer, even on error
        safelyStopTimer(timer);

        incrementCounter(`db.${safeCollection}.${safeOperation}.error`);

        // Re-throw the error for proper handling upstream
        throw error;
    }
}

/**
 * Track S3 operation execution time
 * @param {string} operation - The S3 operation (putObject, getObject, etc.)
 * @param {Function} s3Fn - The S3 function to execute
 * @returns {Promise} - The result of the S3 function
 */
async function trackS3Operation(operation, s3Fn) {
    // Sanitize operation name
    const safeOperation = (operation || 'unknown').replace(/[^a-zA-Z0-9_\.]/g, '_');

    // Create the timer with a meaningful name
    const timer = createTimer(`s3.${safeOperation}`);

    try {
        const result = await s3Fn();

        // Use the safe helper function to stop the timer
        safelyStopTimer(timer);

        return result;
    } catch (error) {
        // Use the safe helper function to stop the timer, even on error
        safelyStopTimer(timer);

        incrementCounter(`s3.${safeOperation}.error`);

        // Re-throw the error for proper handling upstream
        throw error;
    }
}

module.exports = {
    incrementCounter,
    timing,
    createTimer,
    safelyStopTimer,
    apiMetricsMiddleware,
    trackDbQuery,
    trackS3Operation
};