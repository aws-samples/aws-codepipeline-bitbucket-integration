// Specialized mock for AWS SDK Upload class
export class MockUpload {
  constructor(params) {
    this.params = params;
    this.listeners = {};
    this.aborted = false;
  }

  on(event, callback) {
    this.listeners[event] = callback;
    return this;
  }

  async done() {
    if (this.aborted) {
      throw new Error('Upload aborted');
    }

    // Simulate upload success
    return {
      Location: `https://${this.params.Bucket}.s3.amazonaws.com/${this.params.Key}`,
      ETag: '"mock-etag-123"',
      Bucket: this.params.Bucket,
      Key: this.params.Key
    };
  }

  abort() {
    this.aborted = true;
    if (this.listeners.error) {
      this.listeners.error(new Error('Upload aborted'));
    }
  }
}

// Mock S3 Client
export class MockS3Client {
  constructor(config) {
    this.config = config;
  }

  async send(command) {
    const commandName = command.constructor.name;
    
    switch (commandName) {
      case 'HeadObjectCommand':
        // Simulate object exists
        return {
          ContentLength: 1024,
          LastModified: new Date(),
          ETag: '"mock-etag"'
        };
      
      case 'PutObjectCommand':
        return {
          ETag: '"mock-etag"',
          Location: `https://${command.input.Bucket}.s3.amazonaws.com/${command.input.Key}`
        };
      
      default:
        throw new Error(`Unsupported command: ${commandName}`);
    }
  }
}

// Mock CloudWatch Client
export class MockCloudWatchClient {
  constructor(config) {
    this.config = config;
    this.sentCommands = [];
  }

  async send(command) {
    this.sentCommands.push(command);
    return { MessageId: 'mock-message-id' };
  }

  getSentCommands() {
    return this.sentCommands;
  }
}

// Mock SQS Client
export class MockSQSClient {
  constructor(config) {
    this.config = config;
    this.sentMessages = [];
  }

  async send(command) {
    if (command.constructor.name === 'SendMessageCommand') {
      this.sentMessages.push(command.input);
      return { MessageId: 'mock-message-id' };
    }
    throw new Error(`Unsupported command: ${command.constructor.name}`);
  }

  getSentMessages() {
    return this.sentMessages;
  }
}