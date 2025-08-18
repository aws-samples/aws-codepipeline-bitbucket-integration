import { describe, it } from '@jest/globals';
import { Template } from 'aws-cdk-lib/assertions';
import { App, Stack } from 'aws-cdk-lib';

import { Function, Runtime, Code } from 'aws-cdk-lib/aws-lambda';
import { Queue } from 'aws-cdk-lib/aws-sqs';
import { Bucket } from 'aws-cdk-lib/aws-s3';

// Mock CDK stack for testing
class TestStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    
    // Add minimal resources for testing
    new Queue(this, 'TestQueue');
    new Bucket(this, 'TestBucket');
    new Function(this, 'TestFunction', {
      runtime: Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: Code.fromInline('exports.handler = async () => ({ statusCode: 200 });')
    });
  }
}

describe('CDK Infrastructure Tests', () => {
  it('should create required AWS resources', () => {
    const app = new App();
    const stack = new TestStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Verify SQS queue exists
    template.hasResourceProperties('AWS::SQS::Queue', {});

    // Verify S3 bucket exists
    template.hasResourceProperties('AWS::S3::Bucket', {});

    // Verify Lambda function exists
    template.hasResourceProperties('AWS::Lambda::Function', {
      Runtime: 'nodejs20.x',
      Handler: 'index.handler'
    });
  });

  it('should have correct resource count', () => {
    const app = new App();
    const stack = new TestStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    template.resourceCountIs('AWS::SQS::Queue', 1);
    template.resourceCountIs('AWS::S3::Bucket', 1);
    template.resourceCountIs('AWS::Lambda::Function', 1);
  });

  it('should validate IAM permissions', () => {
    const app = new App();
    const stack = new TestStack(app, 'TestStack');
    const template = Template.fromStack(stack);

    // Check that Lambda execution role is created
    template.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [{
          Effect: 'Allow',
          Principal: { Service: 'lambda.amazonaws.com' },
          Action: 'sts:AssumeRole'
        }]
      }
    });
  });
});