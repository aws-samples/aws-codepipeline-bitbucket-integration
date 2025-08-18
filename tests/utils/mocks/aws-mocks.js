import { jest } from '@jest/globals';

export const mockSQSClient = {
  send: jest.fn()
};

export const mockS3Client = {
  send: jest.fn()
};

export const mockCloudWatchClient = {
  send: jest.fn()
};

export const mockSecretsManagerClient = {
  send: jest.fn()
};

export const mockCodePipelineClient = {
  send: jest.fn()
};

export const mockDynamoDBClient = {
  send: jest.fn()
};

export const createMockAWSResponse = (data, error = null) => {
  if (error) {
    return Promise.reject(error);
  }
  return Promise.resolve(data);
};

export const resetAllMocks = () => {
  mockSQSClient.send.mockReset();
  mockS3Client.send.mockReset();
  mockCloudWatchClient.send.mockReset();
  mockSecretsManagerClient.send.mockReset();
  mockCodePipelineClient.send.mockReset();
  mockDynamoDBClient.send.mockReset();
};