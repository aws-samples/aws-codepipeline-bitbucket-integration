import { logger } from '/opt/nodejs/lib/logger.js';
import { CloudWatchClient, PutMetricDataCommand } from '@aws-sdk/client-cloudwatch';

// Initialize CloudWatch client
const cloudWatchClient = new CloudWatchClient({ 
    region: process.env.AWS_REGION || 'us-east-1'
});

export class MetricsPublisher {
    constructor() {
        this.namespace = 'BitbucketIntegration';
        this.component = 'RepositoryProcessor';
    }

    /**
     * Publish a single metric to CloudWatch
     * @param {string} metricName - Name of the metric
     * @param {number} value - Metric value
     * @param {string} unit - Metric unit (default: Count)
     * @param {Array} dimensions - Additional dimensions
     * @returns {Promise<void>}
     */
    async publishMetric(metricName, value, unit = 'Count', dimensions = []) {
        try {
            const metricData = {
                MetricName: metricName,
                Value: value,
                Unit: unit,
                Timestamp: new Date(),
                Dimensions: [
                    { Name: 'Service', Value: 'BitbucketIntegration' },
                    { Name: 'Component', Value: this.component },
                    ...dimensions
                ]
            };

            const command = new PutMetricDataCommand({
                Namespace: this.namespace,
                MetricData: [metricData]
            });

            await cloudWatchClient.send(command);
            
            logger.debug({ 
                metricName, 
                value, 
                unit, 
                dimensions: dimensions.length 
            }, 'Metric published to CloudWatch');
        } catch (error) {
            logger.warn({ 
                error: error.message,
                metricName,
                value
            }, 'Failed to publish metric to CloudWatch');
            // Don't throw error - metrics failure shouldn't break the main flow
        }
    }

    /**
     * Publish multiple metrics in a batch
     * @param {Array} metrics - Array of metric objects
     * @returns {Promise<void>}
     */
    async publishMetrics(metrics) {
        try {
            const metricData = metrics.map(metric => ({
                MetricName: metric.name,
                Value: metric.value,
                Unit: metric.unit || 'Count',
                Timestamp: new Date(),
                Dimensions: [
                    { Name: 'Service', Value: 'BitbucketIntegration' },
                    { Name: 'Component', Value: this.component },
                    ...(metric.dimensions || [])
                ]
            }));

            const command = new PutMetricDataCommand({
                Namespace: this.namespace,
                MetricData: metricData
            });

            await cloudWatchClient.send(command);
            
            logger.debug({ 
                metricsCount: metrics.length 
            }, 'Batch metrics published to CloudWatch');
        } catch (error) {
            logger.warn({ 
                error: error.message,
                metricsCount: metrics.length
            }, 'Failed to publish batch metrics to CloudWatch');
        }
    }

    /**
     * Publish repository processing metrics
     * @param {object} payload - Repository payload
     * @param {object} downloadResult - Download result
     * @param {object} uploadResult - Upload result
     * @param {number} totalProcessingTime - Total processing time in milliseconds
     * @returns {Promise<void>}
     */
    async publishRepositoryMetrics(payload, downloadResult, uploadResult, totalProcessingTime) {
        const dimensions = [
            { Name: 'Project', Value: payload.repository.project.key },
            { Name: 'Repository', Value: payload.repository.name },
            { Name: 'Branch', Value: payload.branch }
        ];

        const metrics = [
            {
                name: 'RepositoriesProcessed',
                value: 1,
                unit: 'Count',
                dimensions
            },
            {
                name: 'TotalProcessingTime',
                value: totalProcessingTime,
                unit: 'Milliseconds',
                dimensions
            }
        ];

        // Add download metrics if available
        if (downloadResult && downloadResult.downloadTime) {
            metrics.push({
                name: 'DownloadTime',
                value: downloadResult.downloadTime,
                unit: 'Milliseconds',
                dimensions
            });
        }

        if (downloadResult && downloadResult.size) {
            metrics.push({
                name: 'RepositorySize',
                value: downloadResult.size,
                unit: 'Bytes',
                dimensions
            });
        }

        // Add upload metrics if available
        if (uploadResult && uploadResult.uploadTime) {
            metrics.push({
                name: 'UploadTime',
                value: uploadResult.uploadTime,
                unit: 'Milliseconds',
                dimensions
            });
        }

        if (uploadResult && uploadResult.size) {
            metrics.push({
                name: 'UploadSize',
                value: uploadResult.size,
                unit: 'Bytes',
                dimensions
            });
        }

        await this.publishMetrics(metrics);
    }

    /**
     * Publish error metrics
     * @param {string} errorType - Type of error
     * @param {object} payload - Repository payload (optional)
     * @param {string} stage - Processing stage where error occurred
     * @returns {Promise<void>}
     */
    async publishErrorMetrics(errorType, payload = null, stage = 'unknown') {
        const dimensions = [
            { Name: 'ErrorType', Value: errorType },
            { Name: 'Stage', Value: stage }
        ];

        // Add repository dimensions if payload is available
        if (payload && payload.repository) {
            dimensions.push(
                { Name: 'Project', Value: payload.repository.project.key },
                { Name: 'Repository', Value: payload.repository.name }
            );
        }

        await this.publishMetric('ProcessingErrors', 1, 'Count', dimensions);
    }

    /**
     * Publish retry metrics
     * @param {string} operation - Operation being retried
     * @param {number} attemptNumber - Current attempt number
     * @param {object} payload - Repository payload (optional)
     * @returns {Promise<void>}
     */
    async publishRetryMetrics(operation, attemptNumber, payload = null) {
        const dimensions = [
            { Name: 'Operation', Value: operation },
            { Name: 'AttemptNumber', Value: attemptNumber.toString() }
        ];

        // Add repository dimensions if payload is available
        if (payload && payload.repository) {
            dimensions.push(
                { Name: 'Project', Value: payload.repository.project.key },
                { Name: 'Repository', Value: payload.repository.name }
            );
        }

        await this.publishMetric('RetryAttempts', 1, 'Count', dimensions);
    }

    /**
     * Publish SQS processing metrics
     * @param {number} batchSize - Number of messages in batch
     * @param {number} successCount - Number of successfully processed messages
     * @param {number} failureCount - Number of failed messages
     * @param {number} processingTime - Total batch processing time
     * @returns {Promise<void>}
     */
    async publishSQSMetrics(batchSize, successCount, failureCount, processingTime) {
        const metrics = [
            {
                name: 'SQSBatchSize',
                value: batchSize,
                unit: 'Count'
            },
            {
                name: 'SQSSuccessCount',
                value: successCount,
                unit: 'Count'
            },
            {
                name: 'SQSFailureCount',
                value: failureCount,
                unit: 'Count'
            },
            {
                name: 'SQSBatchProcessingTime',
                value: processingTime,
                unit: 'Milliseconds'
            }
        ];

        // Calculate success rate
        if (batchSize > 0) {
            const successRate = (successCount / batchSize) * 100;
            metrics.push({
                name: 'SQSSuccessRate',
                value: successRate,
                unit: 'Percent'
            });
        }

        await this.publishMetrics(metrics);
    }

    /**
     * Publish memory and performance metrics
     * @param {object} memoryUsage - Node.js memory usage object
     * @param {number} cpuUsage - CPU usage percentage (optional)
     * @returns {Promise<void>}
     */
    async publishPerformanceMetrics(memoryUsage, cpuUsage = null) {
        const metrics = [
            {
                name: 'MemoryUsedHeap',
                value: memoryUsage.heapUsed,
                unit: 'Bytes'
            },
            {
                name: 'MemoryTotalHeap',
                value: memoryUsage.heapTotal,
                unit: 'Bytes'
            },
            {
                name: 'MemoryExternal',
                value: memoryUsage.external,
                unit: 'Bytes'
            },
            {
                name: 'MemoryRSS',
                value: memoryUsage.rss,
                unit: 'Bytes'
            }
        ];

        // Calculate heap utilization percentage
        if (memoryUsage.heapTotal > 0) {
            const heapUtilization = (memoryUsage.heapUsed / memoryUsage.heapTotal) * 100;
            metrics.push({
                name: 'HeapUtilization',
                value: heapUtilization,
                unit: 'Percent'
            });
        }

        if (cpuUsage !== null) {
            metrics.push({
                name: 'CPUUsage',
                value: cpuUsage,
                unit: 'Percent'
            });
        }

        await this.publishMetrics(metrics);
    }

    /**
     * Create a timer for measuring operation duration
     * @param {string} operationName - Name of the operation
     * @param {object} payload - Repository payload (optional)
     * @returns {object} Timer object with stop method
     */
    createTimer(operationName, payload = null) {
        const startTime = Date.now();
        
        return {
            stop: async () => {
                const duration = Date.now() - startTime;
                
                const dimensions = [
                    { Name: 'Operation', Value: operationName }
                ];

                // Add repository dimensions if payload is available
                if (payload && payload.repository) {
                    dimensions.push(
                        { Name: 'Project', Value: payload.repository.project.key },
                        { Name: 'Repository', Value: payload.repository.name }
                    );
                }

                await this.publishMetric('OperationDuration', duration, 'Milliseconds', dimensions);
                return duration;
            }
        };
    }
}

export const metricsPublisher = new MetricsPublisher();
