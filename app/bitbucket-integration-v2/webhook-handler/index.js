import { logger, withRequestContext } from '/opt/nodejs/lib/logger.js';
import { sharedUtil } from '/opt/nodejs/lib/util.js';
import { webhookValidator, InvalidEventError, InvalidSignatureError, InvalidPayloadError } from './lib/validator.js';
import { SQSClient, SendMessageCommand } from '@aws-sdk/client-sqs';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

// Initialize AWS clients
const sqsClient = new SQSClient({ region: process.env.AWS_REGION || 'us-east-1' });
const cloudWatchClient = new CloudWatchClient({ region: process.env.AWS_REGION || 'us-east-1' });

/**
 * AWS Lambda handler for Bitbucket webhook processing
 * This function validates webhooks and sends them to SQS for asynchronous processing
 */
export const handler = async (event, context) => {
    const requestLogger = withRequestContext(context);
    const startTime = Date.now();
    
    requestLogger.info({ 
        event: {
            httpMethod: event.httpMethod,
            path: event.path,
            headers: Object.keys(event.headers || {}),
            bodySize: event.body ? event.body.length : 0
        }
    }, 'Webhook handler started');

    try {
        // Validate required environment variables
        if (!process.env.SQS_QUEUE_URL) {
            throw new Error('Missing required environment variable: SQS_QUEUE_URL');
        }

        const sqsQueueUrl = process.env.SQS_QUEUE_URL;

        // Normalize headers to lowercase
        const normalizedHeaders = sharedUtil.toLowerCase(event.headers || {});
        
        requestLogger.debug({ 
            normalizedHeaders: Object.keys(normalizedHeaders) 
        }, 'Headers normalized');

        // Handle Bitbucket test events
        if (webhookValidator.isTestEvent(normalizedHeaders)) {
            requestLogger.info('Test event detected, returning success');
            await publishMetrics('TestEvent', 1);
            return sharedUtil.responseToApiGw('200', 'Test event processed successfully');
        }

        // Parse webhook payload to extract repository info
        let eventBody;
        try {
            eventBody = JSON.parse(event.body);
        } catch (error) {
            requestLogger.error({ error: error.message }, 'Failed to parse webhook body');
            await publishMetrics('InvalidPayload', 1);
            throw new InvalidPayloadError('Invalid JSON in webhook body');
        }

        // Extract repository info for secret lookup
        const { projectKey, repoName } = webhookValidator.extractRepositoryInfo(eventBody);
        
        // Normalize project and repo names to lowercase
        const normalizedProjectKey = projectKey.toLowerCase();
        const normalizedRepoName = repoName.toLowerCase();
        
        // Get repository-specific webhook secret with environment
        const envName = process.env.ENVIRONMENT || 'dev';
        const secretName = `bitbucket-integration-v2/${envName}/webhook-secret/${normalizedProjectKey}/${normalizedRepoName}`;
        requestLogger.info({ secretName, projectKey: normalizedProjectKey, repoName: normalizedRepoName, envName }, 'Looking up repository-specific webhook secret');
        
        let bitbucketSecret;
        try {
            bitbucketSecret = await sharedUtil.getSecret(secretName);
        } catch (error) {
            requestLogger.error({ error: error.message, secretName }, 'Failed to get repository-specific secret');
            await publishMetrics('SecretNotFound', 1);
            throw new InvalidSignatureError('Repository webhook secret not found');
        }

        // Validate webhook signature with repository-specific secret
        const isValidSignature = await webhookValidator.validateSignature(
            bitbucketSecret, 
            normalizedHeaders, 
            event.body
        );

        if (!isValidSignature) {
            requestLogger.warn({ projectKey, repoName }, 'Invalid webhook signature for repository');
            await publishMetrics('InvalidSignature', 1);
            throw new InvalidSignatureError('Invalid webhook signature');
        }

        // Validate that it's a branch event
        if (!webhookValidator.isBranchEvent(eventBody)) {
            requestLogger.warn('Invalid event type - not a branch event');
            await publishMetrics('InvalidEventType', 1);
            throw new InvalidEventError('Only branch events are supported');
        }

        // Validate and extract payload data with normalized names
        const validatedPayload = webhookValidator.validateWebhookPayload(eventBody, normalizedProjectKey, normalizedRepoName);
        
        requestLogger.info({
            project: validatedPayload.repository.project.key,
            repository: validatedPayload.repository.name,
            branch: validatedPayload.branch,
            correlationId: validatedPayload.correlationId
        }, 'Webhook payload validated successfully');

        // Send message to SQS for asynchronous processing
        await sendToSQS(sqsQueueUrl, validatedPayload, requestLogger);

        // Publish success metrics
        await publishMetrics('WebhookProcessed', 1, [
            { Name: 'Project', Value: validatedPayload.repository.project.key },
            { Name: 'Repository', Value: validatedPayload.repository.name }
        ]);

        const processingTime = Date.now() - startTime;
        await publishMetrics('WebhookProcessingTime', processingTime, [], 'Milliseconds');

        requestLogger.info({ 
            processingTime,
            correlationId: validatedPayload.correlationId
        }, 'Webhook processed successfully');

        return sharedUtil.responseToApiGw('200', 'Webhook processed successfully', {
            'X-Correlation-ID': validatedPayload.correlationId
        });

    } catch (error) {
        const processingTime = Date.now() - startTime;
        
        requestLogger.error({ 
            error: error.message,
            errorType: error.name,
            processingTime
        }, 'Webhook processing failed');

        // Publish error metrics
        await publishMetrics('WebhookErrors', 1, [
            { Name: 'ErrorType', Value: error.name || 'UnknownError' }
        ]);

        // Return appropriate error response based on error type
        if (error instanceof InvalidSignatureError) {
            return sharedUtil.responseToApiGw('401', 'Invalid webhook signature');
        } else if (error instanceof InvalidEventError) {
            return sharedUtil.responseToApiGw('400', 'Invalid event type');
        } else if (error instanceof InvalidPayloadError) {
            return sharedUtil.responseToApiGw('400', 'Invalid payload format');
        } else {
            return sharedUtil.responseToApiGw('500', 'Internal server error');
        }
    }
};

/**
 * Send validated payload to SQS queue
 * @param {string} queueUrl - SQS queue URL
 * @param {object} payload - Validated webhook payload
 * @param {object} requestLogger - Logger instance
 */
async function sendToSQS(queueUrl, payload, requestLogger) {
    try {
        const messageBody = JSON.stringify(payload);
        
        const command = new SendMessageCommand({
            QueueUrl: queueUrl,
            MessageBody: messageBody,
            MessageAttributes: {
                'CorrelationId': {
                    DataType: 'String',
                    StringValue: payload.correlationId
                },
                'Project': {
                    DataType: 'String',
                    StringValue: payload.repository.project.key
                },
                'Repository': {
                    DataType: 'String',
                    StringValue: payload.repository.name
                },
                'Branch': {
                    DataType: 'String',
                    StringValue: payload.branch
                },
                'Timestamp': {
                    DataType: 'String',
                    StringValue: payload.timestamp
                }
            }
        });

        const result = await sqsClient.send(command);
        
        requestLogger.info({
            messageId: result.MessageId,
            correlationId: payload.correlationId,
            queueUrl
        }, 'Message sent to SQS successfully');

        return result;
    } catch (error) {
        requestLogger.error({ 
            error: error.message,
            queueUrl,
            correlationId: payload.correlationId
        }, 'Failed to send message to SQS');
        throw new Error(`Failed to send message to SQS: ${error.message}`);
    }
}

/**
 * Publish custom metrics to CloudWatch
 * @param {string} metricName - Name of the metric
 * @param {number} value - Metric value
 * @param {Array} dimensions - Optional dimensions
 * @param {string} unit - Metric unit (default: Count)
 */
async function publishMetrics(metricName, value, dimensions = [], unit = 'Count') {
    try {
        const metricData = {
            MetricName: metricName,
            Value: value,
            Unit: unit,
            Timestamp: new Date(),
            Dimensions: [
                { Name: 'Service', Value: 'BitbucketIntegration' },
                { Name: 'Component', Value: 'WebhookHandler' },
                ...dimensions
            ]
        };

        const command = new PutMetricDataCommand({
            Namespace: 'BitbucketIntegration',
            MetricData: [metricData]
        });

        await cloudWatchClient.send(command);
        
        logger.debug({ metricName, value, unit }, 'Metric published to CloudWatch');
    } catch (error) {
        logger.warn({ 
            error: error.message,
            metricName,
            value
        }, 'Failed to publish metric to CloudWatch');
        // Don't throw error - metrics failure shouldn't break the main flow
    }
}
