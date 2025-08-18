import { describe, it, expect } from '@jest/globals';
import { Template } from 'aws-cdk-lib/assertions';
import { App } from 'aws-cdk-lib';
import { BitbucketIntegrationV2EnhancedStack } from '../../../infra/bitbucket-integration-v2/bitbucket-integration-v2-stack-enhanced';

describe('BitbucketIntegrationV2EnhancedStack Tests', () => {
  const testProps = {
    envName: 'test',
    bitbucketServerUrl: 'http://test-bitbucket-server.example.com'
  };

  it('should create S3 buckets with correct configurations', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify S3 buckets are created
    template.resourceCountIs('AWS::S3::Bucket', 2);
    
    // Verify buckets have correct properties
    template.hasResourceProperties('AWS::S3::Bucket', {
      VersioningConfiguration: {
        Status: 'Enabled'
      },
      LifecycleConfiguration: {
        Rules: [
          {
            Status: 'Enabled',
            ExpirationInDays: 30
          }
        ]
      }
    });
  });

  it('should create DynamoDB table for repository mappings', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify DynamoDB table is created
    template.resourceCountIs('AWS::DynamoDB::Table', 1);
    
    // Verify table has correct properties
    template.hasResourceProperties('AWS::DynamoDB::Table', {
      KeySchema: [
        {
          AttributeName: 'repositoryKey',
          KeyType: 'HASH'
        }
      ],
      AttributeDefinitions: [
        {
          AttributeName: 'repositoryKey',
          AttributeType: 'S'
        }
      ],
      BillingMode: 'PAY_PER_REQUEST',
      PointInTimeRecoverySpecification: {
        PointInTimeRecoveryEnabled: true
      }
    });
  });

  it('should create SQS queues with dead letter queue', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify SQS queues are created
    template.resourceCountIs('AWS::SQS::Queue', 2);
    
    // Verify that at least one queue has a RedrivePolicy (DLQ configuration)
    const template_json = template.toJSON();
    const queues = Object.values(template_json.Resources).filter(r => r.Type === 'AWS::SQS::Queue');
    const hasRedrivePolicy = queues.some(q => q.Properties.RedrivePolicy);
    expect(hasRedrivePolicy).toBe(true);
  });

  it('should create Lambda functions with correct configurations', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify Lambda functions are created (webhook handler, repository processor, and possibly shared layer)
    template.resourceCountIs('AWS::Lambda::Function', 3);
    
    // Verify webhook handler Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
      Timeout: 30,
      MemorySize: 256,
      ReservedConcurrentExecutions: 10
    });
    
    // Verify repository processor Lambda
    template.hasResourceProperties('AWS::Lambda::Function', {
      Handler: 'index.handler',
      Runtime: 'nodejs20.x',
      Timeout: 300,
      MemorySize: 1024,
      ReservedConcurrentExecutions: 5
    });
  });

  it('should create API Gateway with webhook endpoint', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify API Gateway is created
    template.resourceCountIs('AWS::ApiGateway::RestApi', 1);
    
    // Verify API Gateway has webhook resource and methods (POST, OPTIONS for CORS, etc.)
    template.resourceCountIs('AWS::ApiGateway::Resource', 1);
    template.resourceCountIs('AWS::ApiGateway::Method', 3);
    
    // Verify method is POST
    template.hasResourceProperties('AWS::ApiGateway::Method', {
      HttpMethod: 'POST',
      AuthorizationType: 'NONE'
    });
  });

  it('should create CloudWatch dashboard for monitoring', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify CloudWatch dashboard is created
    template.resourceCountIs('AWS::CloudWatch::Dashboard', 1);
  });

  it('should create outputs with important information', () => {
    const app = new App();
    const stack = new BitbucketIntegrationV2EnhancedStack(app, 'TestBitbucketIntegrationV2Stack', testProps);
    const template = Template.fromStack(stack);

    // Verify outputs are created
    template.hasOutput('WebhookEndpoint', {});
    template.hasOutput('SourcesBucketName', {});
    template.hasOutput('ArtifactsBucketName', {});
    template.hasOutput('BitbucketTokenSecretName', {});
    template.hasOutput('RepositoryMappingTableName', {});
  });
});
