require('dotenv').config();
const { Sequelize } = require('sequelize');
const mysql = require('mysql2/promise');
const { trackDbQuery } = require('./utils/metrics'); // Import the metrics tracking functionality
const logger = require('./utils/logger'); // Import logger for debug logs

// Environment variables
const DB_NAME = process.env.DB_NAME;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT;

// Debug log connection parameters (hiding sensitive info)
logger.debug('Database configuration loaded', {
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    hasPassword: !!DB_PASSWORD
});

// Function to create the database if it doesn't exist
async function createDatabaseIfNotExists() {
    try {
        logger.debug('Attempting to establish database connection');

        // Track database connection time using metrics
        return await trackDbQuery('connection', 'system', async () => {
            const connection = await mysql.createConnection({
                host: DB_HOST,
                port: DB_PORT,
                user: DB_USER,
                password: DB_PASSWORD,
            });

            logger.debug('Connection established, checking if database exists');

            // Check if the database exists; create it if not
            await connection.query(`CREATE DATABASE IF NOT EXISTS \`${DB_NAME}\`;`);
            console.log(`Database "${DB_NAME}" is ready.`);
            logger.debug(`Database "${DB_NAME}" is ready for use`);

            await connection.end();
            return true;
        });
    } catch (error) {
        logger.error('Error creating database', {
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        console.error('Error creating database:', error);
        process.exit(1); // Exit the process on failure
    }
}

// Create the Sequelize instance
const sequelize = new Sequelize(DB_NAME, DB_USER, DB_PASSWORD, {
    host: DB_HOST,
    port: DB_PORT,
    dialect: 'mysql',
    logging: false, // Disable default logging

    // Add instrumentation to all database queries
    hooks: {
        // Before query execution
        beforeQuery: (options) => {
            // Store the query start time on the options object
            options._startTime = process.hrtime();

            // Debug log for query about to be executed (omitting sensitive data)
            logger.debug('Executing database query', {
                queryType: options.type || 'unknown',
                queryOperation: options.sql ? options.sql.split(' ')[0].toLowerCase() : 'unknown',
                hasBindParameters: !!options.bind && Object.keys(options.bind).length > 0
            });
        },

        // After query execution
        afterQuery: (options) => {
            if (options._startTime) {
                const diff = process.hrtime(options._startTime);
                // Convert to milliseconds (1 second = 1e9 nanoseconds)
                const duration = (diff[0] * 1e3) + (diff[1] / 1e6);

                // Extract query operation type from SQL statement
                let operation = 'query';
                const sql = options.sql ? options.sql.toLowerCase() : '';

                if (sql.startsWith('select')) {
                    operation = 'select';
                } else if (sql.startsWith('insert')) {
                    operation = 'insert';
                } else if (sql.startsWith('update')) {
                    operation = 'update';
                } else if (sql.startsWith('delete')) {
                    operation = 'delete';
                }

                // Get table name if possible (simplified approach)
                let tableName = 'unknown';
                const fromMatch = sql.match(/from\s+`?(\w+)`?/i);
                const intoMatch = sql.match(/into\s+`?(\w+)`?/i);
                const updateMatch = sql.match(/update\s+`?(\w+)`?/i);

                if (fromMatch && fromMatch[1]) {
                    tableName = fromMatch[1];
                } else if (intoMatch && intoMatch[1]) {
                    tableName = intoMatch[1];
                } else if (updateMatch && updateMatch[1]) {
                    tableName = updateMatch[1];
                }

                // Debug log for completed query
                logger.debug('Query completed', {
                    operation,
                    tableName,
                    durationMs: duration.toFixed(2)
                });

                // Use the timing function from metrics.js
                const { timing } = require('./utils/metrics');
                timing(`db.${tableName}.${operation}`, duration);
            }
        }
    }
});

// Debug log for database initialization
logger.debug('Sequelize instance created, ready to authenticate');

// Add database connection test function
const testDatabaseConnection = async () => {
    try {
        logger.debug('Testing database connection');
        await sequelize.authenticate();
        logger.debug('Database connection test successful');
        return true;
    } catch (error) {
        logger.error('Database connection test failed', {
            errorMessage: error.message,
            errorCode: error.code,
            errorStack: error.stack?.split('\n').slice(0, 3).join('\n')
        });
        return false;
    }
};

// Add a wrapper function for direct queries that need metrics
const executeQuery = async (sql, options = {}) => {
    const type = sql.trim().split(' ')[0].toLowerCase();
    const tableName = options.tableName || 'raw';

    logger.debug('Executing raw query', {
        type,
        tableName,
        queryLength: sql.length
    });

    return await trackDbQuery(type, tableName, async () => {
        try {
            const result = await sequelize.query(sql, options);
            logger.debug('Raw query executed successfully', {
                type,
                tableName,
                resultRowCount: Array.isArray(result[0]) ? result[0].length : 0
            });
            return result;
        } catch (error) {
            logger.error('Raw query execution failed', {
                type,
                tableName,
                errorMessage: error.message,
                errorCode: error.code
            });
            throw error; // Re-throw to handle at the caller level
        }
    });
};

module.exports = {
    sequelize,
    createDatabaseIfNotExists,
    testDatabaseConnection, // Export the test function
    executeQuery // Export the instrumented query function
};