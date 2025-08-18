import { describe, it, expect, jest, beforeEach, afterEach } from '@jest/globals';
import { handler as webhookHandler } from '../../../app/bitbucket-integration-v2/webhook-handler/index.js';
import { handler as processorHandler } from '../../../app/bitbucket-integration-v2/repository-processor/index.js';
import { testEvent } from '../../fixtures/payloads/webhook-payload.js';
import { mockSQSClient, mockS3Client, mockCodePipelineClient, resetAllMocks } from '../../utils/mocks/aws-mocks.js';

describe('End-to-End Integration Tests', () => {
  const mockContext = {
    awsRequestId: 'test-request-id',
    functionName: 'test-function',
    functionVersion: '1',
    memoryLimitInMB: 128,
    getRemainingTimeInMillis: () => 30000
  };

  beforeEach(() => {
    resetAllMocks();
    process.env.SQS_QUEUE_URL = 'https://sqs.us-east-1.amazonaws.com/123456789/test-queue';
    process.env.S3_BUCKET_NAME = 'test-bucket';
    process.env.BITBUCKET_SERVER_URL = 'https://bitbucket.example.com';
    process.env.BITBUCKET_TOKEN = 'bitbucket-integration-v2/token';
    process.env.DYNAMODB_TABLE_NAME = 'test-table';
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should process webhook through complete pipeline', async () => {
    // Mock webhook processing
    mockSQSClient.send.mockResolvedValue({ MessageId: 'test-message-id' });
    
    // Mock repository processing
    mockS3Client.send.mockResolvedValue({
      Location: 'https://test-bucket.s3.amazonaws.com/test-key',
      ETag: '"test-etag"'
    });
    
    mockCodePipelineClient.send.mockResolvedValue({
      pipelineExecutionId: 'test-execution-id'
    });

    // Step 1: Process webhook
    const webhookResult = await webhookHandler(testEvent, mockContext);
    expect(webhookResult.statusCode).toBe(200);
    expect(mockSQSClient.send).toHaveBeenCalled();

    // Step 2: Process SQS message
    const sqsEvent = {
      Records: [{
        messageId: 'test-message-id',
        body: JSON.stringify({
          repository: { project: { key: 'TEST' }, name: 'test-repo' },
          branch: 'main',
          correlationId: 'test-correlation-id',
          timestamp: '2024-01-01T00:00:00.000Z'
        })
      }]
    };

    const processorResult = await processorHandler(sqsEvent, mockContext);
    expect(processorResult.batchItemFailures).toHaveLength(0);
  });
});