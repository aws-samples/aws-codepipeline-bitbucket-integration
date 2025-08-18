// Global test setup to prevent real AWS calls
process.env.NODE_ENV = 'test';
process.env.ENVIRONMENT = 'test';

// Detect if this is an integration test
const isIntegrationTest = process.argv.some(arg => 
  arg.includes('integration') || 
  arg.includes('end-to-end') ||
  arg.includes('e2e') ||
  process.env.TEST_TYPE === 'integration'
);

console.log(`🔧 Test Setup: ${isIntegrationTest ? 'Integration Test' : 'Unit Test'} mode detected`);

if (!isIntegrationTest) {
  // Only set fake credentials for unit tests to prevent real AWS calls
  console.log('   Setting fake AWS credentials for unit tests');
  process.env.AWS_REGION = 'us-east-1';
  process.env.AWS_ACCESS_KEY_ID = 'test-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'test-secret';
  process.env.AWS_SESSION_TOKEN = 'test-token';
  
  // Mock AWS SDK at the global level for unit tests
  global.mockAWSConfig = {
    region: 'us-east-1',
    credentials: {
      accessKeyId: 'test-key',
      secretAccessKey: 'test-secret',
      sessionToken: 'test-token'
    }
  };
} else {
  // For integration tests, allow real AWS credentials to be used
  console.log('   Integration test mode: allowing real AWS credentials');
  
  // Only set AWS_REGION if not already set, but don't override real credentials
  if (!process.env.AWS_REGION && !process.env.AWS_DEFAULT_REGION) {
    process.env.AWS_REGION = 'us-east-1';
    console.log('   Set default AWS_REGION to us-east-1');
  }
  
  // Don't set global.mockAWSConfig for integration tests
  console.log('   Skipping AWS SDK mocking for integration tests');
}

// Prevent real network calls
if (typeof global.fetch === 'undefined') {
  global.fetch = () => Promise.reject(new Error('Network calls not allowed in tests'));
}
