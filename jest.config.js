export default {
  testEnvironment: 'node',
  testMatch: [
    '**/tests/**/*.test.js'
  ],
  collectCoverageFrom: [
    'app/**/*.js',
    '!app/**/node_modules/**'
  ],
  setupFilesAfterEnv: ['<rootDir>/tests/setup.js'],
  testTimeout: 30000,
  moduleNameMapper: {
    '^/opt/nodejs/lib/logger\\.js$': '<rootDir>/tests/mocks/lambda-layer/logger.js',
    '^/opt/nodejs/lib/util\\.js$': '<rootDir>/tests/mocks/lambda-layer/util.js',
    '^@aws-sdk/client-s3$': '<rootDir>/tests/mocks/lambda-layer/aws-s3.js',
    '^@aws-sdk/lib-storage$': '<rootDir>/tests/mocks/lambda-layer/aws-s3-storage.js'
  }
};