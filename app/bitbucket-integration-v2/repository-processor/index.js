import { logger, withRequestContext, withCorrelationId } from '/opt/nodejs/lib/logger.js';
import { sharedUtil } from '/opt/nodejs/lib/util.js';
import { repositoryDownloader } from './lib/downloader.js';
import { s3Uploader } from './lib/uploader.js';
import { metricsPublisher } from './lib/metrics.js';

/**
 * AWS Lambda handler for processing repository download and upload
 * This function processes SQS messages containing repository information
 */
export const handler = async (event, context) => {
    const requestLogger = withRequestContext(context);
    const batchStartTime = Date.now();
    
    requestLogger.info({ 
        recordCount: event.Records.length,
        functionName: context.functionName,
        remainingTime: context.getRemainingTimeInMillis()
    }, 'Repository processor started');

    let successCount = 0;
    let failureCount = 0;
    const results = [];

    // Process each SQS record
    for (const record of event.Records) {
        const recordStartTime = Date.now();
        let correlationLogger = requestLogger;
        let payload = null;

        try {
            // Parse SQS message
            payload = JSON.parse(record.body);
            
            // Create correlation logger
            correlationLogger = withCorrelationId(payload.correlationId || sharedUtil.generateCorrelationId());
            
            correlationLogger.info({
                messageId: record.messageId,
                project: payload.repository.project.key,
                repository: payload.repository.name,
                branch: payload.branch,
                correlationId: payload.correlationId
            }, 'Processing repository record');

            // Validate required environment variables
            const requiredEnvVars = ['BITBUCKET_SERVER_URL', 'BITBUCKET_TOKEN', 'S3_BUCKET_NAME'];
            const awsRegion = process.env.REGION || process.env.AWS_REGION;
            if (!awsRegion) requiredEnvVars.push('REGION or AWS_REGION');
            
            const missingVars = requiredEnvVars.filter(varName => 
                varName.includes('REGION') ? !awsRegion : !process.env[varName]
            );
            
            if (missingVars.length > 0) {
                throw new Error(`Missing required environment variables: ${missingVars.join(', ')}`);
            }

            const bitbucketServerUrl = process.env.BITBUCKET_SERVER_URL;
            const s3BucketName = process.env.S3_BUCKET_NAME;

            // Get Bitbucket token from secrets
            const bitbucketToken = await sharedUtil.getSecret(process.env.BITBUCKET_TOKEN);

            // Extract proxy configuration
            const proxy = getProxyConfig();

            // Prepare repository configuration
            const repoConfig = {
                serverUrl: bitbucketServerUrl,
                projectName: payload.repository.project.key,
                repoName: payload.repository.name,
                branch: payload.branch,
                token: bitbucketToken
            };

            correlationLogger.info({ repoConfig: { ...repoConfig, token: '[REDACTED]' } }, 'Repository configuration prepared');

            // Create processing timer
            const processingTimer = metricsPublisher.createTimer('RepositoryProcessing', payload);

            // Download repository with retry logic
            const downloadTimer = metricsPublisher.createTimer('RepositoryDownload', payload);
            
            correlationLogger.info('Starting repository download');
            const fileStream = await repositoryDownloader.downloadRepository(repoConfig, proxy, {
                maxRetries: 3,
                shouldRetry: (error) => repositoryDownloader.shouldRetryDownload(error)
            });
            
            const downloadTime = await downloadTimer.stop();
            correlationLogger.info({ downloadTime }, 'Repository download completed');

            // Generate S3 key
            const s3Key = s3Uploader.generateS3Key(
                repoConfig.projectName,
                repoConfig.repoName,
                repoConfig.branch,
                payload.correlationId
            );

            // Prepare upload metadata
            const uploadMetadata = {
                'correlation-id': payload.correlationId,
                'project': repoConfig.projectName,
                'repository': repoConfig.repoName,
                'branch': repoConfig.branch,
                'processed-timestamp': new Date().toISOString(),
                'bitbucket-server': bitbucketServerUrl
            };

            // Upload to S3 with retry logic
            const uploadTimer = metricsPublisher.createTimer('S3Upload', payload);
            
            correlationLogger.info({ s3Key, bucket: s3BucketName }, 'Starting S3 upload');
            const uploadResult = await s3Uploader.uploadToS3(
                fileStream,
                s3BucketName,
                s3Key,
                uploadMetadata,
                {
                    maxRetries: 3,
                    partSize: 10 * 1024 * 1024, // 10MB parts
                    queueSize: 4
                }
            );
            
            const uploadTime = await uploadTimer.stop();
            const totalProcessingTime = await processingTimer.stop();

            correlationLogger.info({
                s3Location: uploadResult.location,
                etag: uploadResult.etag,
                uploadTime,
                totalProcessingTime
            }, 'Repository processing completed successfully');

            // Lookup pipeline name from DynamoDB and start execution
            try {
                const dynamoTableName = process.env.DYNAMODB_TABLE_NAME;
                if (!dynamoTableName) {
                    throw new Error('DYNAMODB_TABLE_NAME environment variable is not defined');
                }
                
                // Import DynamoDB SDK
                const { DynamoDBClient, GetItemCommand } = await import('@aws-sdk/client-dynamodb');
                const dynamoClient = new DynamoDBClient({ 
                    region: awsRegion
                });
                
                // Lookup pipeline name
                const repositoryKey = `${payload.repository.project.key.toLowerCase()}/${payload.repository.name}/${payload.branch}`;
                correlationLogger.info({ repositoryKey }, 'Looking up pipeline name in DynamoDB');
                
                const dynamoResult = await dynamoClient.send(new GetItemCommand({
                    TableName: dynamoTableName,
                    Key: { repositoryKey: { S: repositoryKey } }
                }));
                
                const pipelineName = dynamoResult.Item?.pipelineName?.S;
                if (!pipelineName) {
                    correlationLogger.warn({ repositoryKey }, 'No pipeline found for repository key');
                    return;
                }
                
                correlationLogger.info({ pipelineName, repositoryKey }, 'Found pipeline, starting execution');
                
                // Import CodePipeline SDK
                const { CodePipelineClient, StartPipelineExecutionCommand } = await import('@aws-sdk/client-codepipeline');
                const codePipelineClient = new CodePipelineClient({ 
                    region: awsRegion
                });
                
                // Start pipeline (Lambda triggered, no sourceRevisions needed)
                const command = new StartPipelineExecutionCommand({
                    name: pipelineName
                });
                
                const response = await codePipelineClient.send(command);
                
                correlationLogger.info({
                    pipelineName,
                    executionId: response.pipelineExecutionId,
                    sourceFile: s3Key
                }, 'CodePipeline execution started successfully');
                
                // Publish pipeline triggered metric
                await metricsPublisher.publishMetric('PipelineTriggered', 1, 'Count', [
                    { Name: 'Project', Value: payload.repository.project.key },
                    { Name: 'Repository', Value: payload.repository.name },
                    { Name: 'Branch', Value: payload.branch },
                    { Name: 'Pipeline', Value: pipelineName }
                ]);
            } catch (error) {
                correlationLogger.error({
                    error: error.message,
                    repositoryKey: `${payload.repository.project.key}/${payload.repository.name}/${payload.branch}`
                }, 'Failed to start CodePipeline execution');
                
                // Don't fail main processing if pipeline can't be started
            }

            // Publish success metrics
            await metricsPublisher.publishRepositoryMetrics(
                payload,
                { downloadTime },
                { uploadTime, size: uploadResult.size },
                totalProcessingTime
            );

            // Publish performance metrics
            const memoryUsage = process.memoryUsage();
            await metricsPublisher.publishPerformanceMetrics(memoryUsage);

            successCount++;
            results.push({
                messageId: record.messageId,
                correlationId: payload.correlationId,
                status: 'success',
                s3Location: uploadResult.location,
                processingTime: totalProcessingTime
            });

        } catch (error) {
            const processingTime = Date.now() - recordStartTime;
            
            correlationLogger.error({
                error: error.message,
                errorType: error.name,
                messageId: record.messageId,
                processingTime,
                payload: payload ? {
                    project: payload.repository?.project?.key,
                    repository: payload.repository?.name,
                    branch: payload.branch
                } : null
            }, 'Repository processing failed');

            // Publish error metrics
            const errorType = error.name || 'UnknownError';
            const stage = determineErrorStage(error);
            await metricsPublisher.publishErrorMetrics(errorType, payload, stage);

            failureCount++;
            results.push({
                messageId: record.messageId,
                correlationId: payload?.correlationId,
                status: 'failed',
                error: error.message,
                errorType: errorType,
                processingTime
            });

            // Re-throw error to send message to DLQ
            throw error;
        }
    }

    const batchProcessingTime = Date.now() - batchStartTime;

    // Publish batch processing metrics
    await metricsPublisher.publishSQSMetrics(
        event.Records.length,
        successCount,
        failureCount,
        batchProcessingTime
    );

    requestLogger.info({
        totalRecords: event.Records.length,
        successCount,
        failureCount,
        batchProcessingTime,
        results: results.map(r => ({
            messageId: r.messageId,
            status: r.status,
            processingTime: r.processingTime
        }))
    }, 'Repository processor batch completed');

    return {
        batchItemFailures: results
            .filter(r => r.status === 'failed')
            .map(r => ({ itemIdentifier: r.messageId }))
    };
};

/**
 * Extract proxy configuration from environment variables
 * @returns {object|undefined} Proxy configuration or undefined
 */
function getProxyConfig() {
    const { WEBPROXY_HOST, WEBPROXY_PORT } = process.env;
    
    if (WEBPROXY_HOST && WEBPROXY_PORT) {
        logger.info({ host: WEBPROXY_HOST, port: WEBPROXY_PORT }, 'Using proxy configuration');
        return {
            host: WEBPROXY_HOST,
            port: WEBPROXY_PORT,
        };
    }

    logger.debug('No proxy configuration found');
    return undefined;
}

/**
 * Determine the stage where the error occurred based on error characteristics
 * @param {Error} error - The error that occurred
 * @returns {string} Error stage
 */
function determineErrorStage(error) {
    const errorMessage = error.message.toLowerCase();
    
    if (errorMessage.includes('download') || errorMessage.includes('bitbucket') || errorMessage.includes('repository')) {
        return 'download';
    }
    
    if (errorMessage.includes('upload') || errorMessage.includes('s3') || errorMessage.includes('bucket')) {
        return 'upload';
    }
    
    if (errorMessage.includes('secret') || errorMessage.includes('parameter')) {
        return 'configuration';
    }
    
    if (errorMessage.includes('parse') || errorMessage.includes('json') || errorMessage.includes('payload')) {
        return 'parsing';
    }
    
    return 'unknown';
}

/**
 * Handle graceful shutdown
 */
process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, performing graceful shutdown');
    
    // Publish final metrics
    const memoryUsage = process.memoryUsage();
    await metricsPublisher.publishPerformanceMetrics(memoryUsage);
    
    // Allow time for metrics to be sent
    setTimeout(() => {
        process.exit(0);
    }, 1000);
});

/**
 * Handle uncaught exceptions
 */
process.on('uncaughtException', async (error) => {
    logger.error({ error: error.message, stack: error.stack }, 'Uncaught exception');
    
    // Publish error metric
    await metricsPublisher.publishErrorMetrics('UncaughtException', null, 'runtime');
    
    process.exit(1);
});

/**
 * Handle unhandled promise rejections
 */
process.on('unhandledRejection', async (reason, promise) => {
    logger.error({ reason, promise }, 'Unhandled promise rejection');
    
    // Publish error metric
    await metricsPublisher.publishErrorMetrics('UnhandledRejection', null, 'runtime');
    
    process.exit(1);
});
