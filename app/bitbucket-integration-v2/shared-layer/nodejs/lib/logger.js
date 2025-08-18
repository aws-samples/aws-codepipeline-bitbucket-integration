import pino from 'pino';

// Configure logger with structured logging
const logger = pino({
    level: process.env.LOG_LEVEL || 'info',
    formatters: {
        level: (label) => {
            return { level: label };
        },
    },
    timestamp: pino.stdTimeFunctions.isoTime,
    base: {
        service: 'bitbucket-integration',
        version: process.env.SERVICE_VERSION || '2.0.0',
        environment: process.env.ENVIRONMENT || process.env.NODE_ENV || 'unknown'
    }
});

// Add correlation ID support for tracing
export const withCorrelationId = (correlationId) => {
    return logger.child({ correlationId });
};

// Add request context logging
export const withRequestContext = (context) => {
    return logger.child({
        requestId: context.awsRequestId,
        functionName: context.functionName,
        functionVersion: context.functionVersion,
        memoryLimitInMB: context.memoryLimitInMB,
        remainingTimeInMS: context.getRemainingTimeInMillis()
    });
};

export { logger };
