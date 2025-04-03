const winston = require('winston');
const { createLogger, format, transports } = winston;
const WinstonCloudWatch = require('winston-cloudwatch');
const { v4: uuidv4 } = require('uuid');

// Custom format to filter out debug logs in non-development environments
const environmentFilter = format((info) => {
    // In non-development environments, skip debug logs
    if (info.level === 'debug' && process.env.NODE_ENV !== 'development') {
        return false;
    }
    return info;
});

// Create environment-dependent logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
        environmentFilter(),
        format.timestamp(),
        format.json()
    ),
    defaultMeta: {
        service: 'webapp',
        environment: process.env.NODE_ENV || 'development',
        instanceId: process.env.INSTANCE_ID || uuidv4().substring(0, 8) // For correlation in CloudWatch
    },
    transports: [
        new transports.Console()
    ]
});

// Add CloudWatch transport when not in development/test mode
if (process.env.NODE_ENV !== 'development' && process.env.NODE_ENV !== 'test') {
    const logGroupName = 'webapp-logs';

    logger.add(new WinstonCloudWatch({
        logGroupName: logGroupName,
        logStreamName: `${process.env.INSTANCE_ID || uuidv4().substring(0, 8)}-winston-${new Date().toISOString().split('T')[0]}`,
        awsRegion: process.env.AWS_REGION || 'us-east-1',
        messageFormatter: ({ level, message, ...meta }) =>
            JSON.stringify({
                level,
                message,
                ...meta
            })
    }));

    logger.info(`Logger initialized with CloudWatch log group: ${logGroupName}`);
} else {
    // In development mode, inform that debug logs are enabled
    logger.info('Debug logging enabled in development mode');
}

// Add a helper method to check if debug logging is active
// This can be useful to avoid expensive string operations when debug won't be logged
logger.isDebugEnabled = () => {
    return process.env.NODE_ENV === 'development' && logger.levels[logger.level] >= logger.levels['debug'];
};

module.exports = logger;