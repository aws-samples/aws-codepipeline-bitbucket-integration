
import { Readable } from 'stream';

export const createMockStream = (data = 'test data') => {
  return new Readable({
    read() {
      this.push(data);
      this.push(null);
    }
  });
};

export const createMockContext = (overrides = {}) => ({
  awsRequestId: 'test-request-id',
  functionName: 'test-function',
  functionVersion: '1',
  memoryLimitInMB: 128,
  getRemainingTimeInMillis: () => 30000,
  ...overrides
});

export const createMockEvent = (overrides = {}) => ({
  httpMethod: 'POST',
  path: '/webhook',
  headers: {
    'content-type': 'application/json',
    'x-hub-signature': 'sha256=test-signature'
  },
  body: JSON.stringify({ test: 'payload' }),
  ...overrides
});

export const createSQSRecord = (body, overrides = {}) => ({
  messageId: 'test-message-id',
  receiptHandle: 'test-receipt-handle',
  body: JSON.stringify(body),
  attributes: {},
  messageAttributes: {},
  md5OfBody: 'test-md5',
  eventSource: 'aws:sqs',
  eventSourceARN: 'arn:aws:sqs:us-east-1:123456789:test-queue',
  awsRegion: 'us-east-1',
  ...overrides
});

export const waitFor = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const mockEnvironment = (envVars) => {
  const originalEnv = { ...process.env };
  
  Object.assign(process.env, envVars);
  
  return () => {
    process.env = originalEnv;
  };
};

export const expectMetricPublished = (mockClient, metricName, expectedValue) => {
  expect(mockClient.send).toHaveBeenCalledWith(
    expect.objectContaining({
      input: expect.objectContaining({
        MetricData: expect.arrayContaining([
          expect.objectContaining({
            MetricName: metricName,
            Value: expectedValue
          })
        ])
      })
    })
  );
};