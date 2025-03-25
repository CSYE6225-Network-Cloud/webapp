const StatsD = require('hot-shots');
const logger = require('./logger');

// Initialize StatsD client
const client = new StatsD({
    host: process.env.STATSD_HOST || 'localhost',
    port: process.env.STATSD_PORT || 8125,
    prefix: 'webapp.',
    errorHandler: error => {
        logger.error('StatsD error', { error: error.message });
    }
});

// Metric utility wrapper
const metrics = {
    // Increment a counter
    incrementCounter: (name, tags = {}) => {
        try {
            client.increment(name, 1, tags);
        } catch (error) {
            logger.error('Failed to increment counter', { metric: name, error: error.message });
        }
    },

    // Start a timer and return a function to end it
    startTimer: (name, tags = {}) => {
        try {
            const timing = client.timing(name, tags);
            return {
                end: () => {
                    try {
                        timing.stop();
                    } catch (error) {
                        logger.error('Failed to stop timer', { metric: name, error: error.message });
                    }
                }
            };
        } catch (error) {
            logger.error('Failed to start timer', { metric: name, error: error.message });
            // Return a dummy end function to prevent errors
            return { end: () => {} };
        }
    },

    // Wrap a function with timing
    timeOperation: async (name, operation, tags = {}) => {
        const timer = metrics.startTimer(name, tags);
        try {
            const result = await operation();
            timer.end();
            return result;
        } catch (error) {
            timer.end();
            throw error;
        }
    }
};

module.exports = metrics;