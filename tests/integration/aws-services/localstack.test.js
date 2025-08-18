import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { SQSClient, CreateQueueCommand, DeleteQueueCommand } from '@aws-sdk/client-sqs';
import { S3Client, CreateBucketCommand, DeleteBucketCommand } from '@aws-sdk/client-s3';

const localstackConfig = {
  endpoint: 'http://localhost:4566',
  region: 'us-east-1',
  credentials: {
    accessKeyId: 'test',
    secretAccessKey: 'test'
  }
};

describe('LocalStack Integration Tests', () => {
  let sqsClient, s3Client;
  let queueUrl, bucketName;

  beforeAll(async () => {
    sqsClient = new SQSClient(localstackConfig);
    s3Client = new S3Client(localstackConfig);
    
    // Create test resources
    bucketName = 'test-integration-bucket';
    const queueName = 'test-integration-queue';
    
    try {
      await s3Client.send(new CreateBucketCommand({ Bucket: bucketName }));
      const queueResult = await sqsClient.send(new CreateQueueCommand({ QueueName: queueName }));
      queueUrl = queueResult.QueueUrl;
    } catch (error) {
      console.warn('LocalStack setup failed:', error.message);
    }
  });

  afterAll(async () => {
    try {
      await s3Client.send(new DeleteBucketCommand({ Bucket: bucketName }));
      await sqsClient.send(new DeleteQueueCommand({ QueueUrl: queueUrl }));
    } catch (error) {
      console.warn('LocalStack cleanup failed:', error.message);
    }
  });

  it('should create and interact with SQS queue', async () => {
    if (!queueUrl) {
      console.warn('Skipping SQS test - LocalStack not available');
      return;
    }

    const { SendMessageCommand, ReceiveMessageCommand } = await import('@aws-sdk/client-sqs');
    
    // Send message
    await sqsClient.send(new SendMessageCommand({
      QueueUrl: queueUrl,
      MessageBody: JSON.stringify({ test: 'message' })
    }));

    // Receive message
    const result = await sqsClient.send(new ReceiveMessageCommand({
      QueueUrl: queueUrl,
      MaxNumberOfMessages: 1
    }));

    expect(result.Messages).toHaveLength(1);
    expect(JSON.parse(result.Messages[0].Body)).toEqual({ test: 'message' });
  });

  it('should upload and retrieve from S3', async () => {
    if (!bucketName) {
      console.warn('Skipping S3 test - LocalStack not available');
      return;
    }

    const { PutObjectCommand, GetObjectCommand } = await import('@aws-sdk/client-s3');
    
    const testKey = 'test-file.txt';
    const testContent = 'test content';

    // Upload object
    await s3Client.send(new PutObjectCommand({
      Bucket: bucketName,
      Key: testKey,
      Body: testContent
    }));

    // Retrieve object
    const result = await s3Client.send(new GetObjectCommand({
      Bucket: bucketName,
      Key: testKey
    }));

    const content = await result.Body.transformToString();
    expect(content).toBe(testContent);
  });
});