const winston = require('winston');
const { createLogger, format, transports } = winston;
const WinstonCloudWatch = require('winston-cloudwatch');
const { v4: uuidv4 } = require('uuid');

// Create environment-dependent logger
const logger = createLogger({
    level: process.env.LOG_LEVEL || 'info',
    format: format.combine(
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
}

module.exports = logger;