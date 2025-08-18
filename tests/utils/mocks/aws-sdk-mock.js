import { jest } from '@jest/globals';

export const mockSecretsManager = {
  send: jest.fn()
};

export const mockCloudWatch = {
  send: jest.fn()
};

export const mockS3 = {
  send: jest.fn()
};

export const mockUpload = {
  on: jest.fn(),
  done: jest.fn()
};