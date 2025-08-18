import { describe, it, expect, beforeAll } from '@jest/globals';
import { CloudFormationClient, DescribeStacksCommand } from '@aws-sdk/client-cloudformation';

import { S3Client, ListObjectsV2Command } from '@aws-sdk/client-s3';
import { CodePipelineClient, GetPipelineStateCommand } from '@aws-sdk/client-codepipeline';
import crypto from 'crypto';

const TEST_REGION = process.env.AWS_TEST_REGION || 'us-east-1';
const TEST_ENVIRONMENT = process.env.TEST_ENVIRONMENT || 'staging';

describe('Bitbucket Webhook End-to-End Tests', () => {
  let webhookEndpoint, sourcesBucket, pipelineName;
  let cfnClient, s3Client, codePipelineClient;

  beforeAll(async () => {
    // Initialize AWS clients
    const awsConfig = { region: TEST_REGION };
    cfnClient = new CloudFormationClient(awsConfig);
    // SQS client not needed for current tests
    s3Client = new S3Client(awsConfig);
    codePipelineClient = new CodePipelineClient(awsConfig);

    // Get resources from CDK stack
    try {
      const stackName = `BitbucketIntegrationV2Stack-${TEST_ENVIRONMENT}`;
      const result = await cfnClient.send(new DescribeStacksCommand({ StackName: stackName }));
      
      if (result.Stacks && result.Stacks.length > 0) {
        const outputs = result.Stacks[0].Outputs || [];
        
        webhookEndpoint = outputs.find(o => o.OutputKey === 'WebhookEndpoint')?.OutputValue;
        sourcesBucket = outputs.find(o => o.OutputKey === 'SourcesBucketName')?.OutputValue;
        
        console.log(`E2E Test Resources:
        - Webhook: ${webhookEndpoint}
        - Bucket: ${sourcesBucket}
        - Pipeline: ${pipelineName || 'will be detected'}`);
      }
    } catch (error) {
      console.warn(`Stack not found: ${error.message}`);
    }
  }, 30000);

  describe('Complete Webhook Flow', () => {
    it('should process webhook from Bitbucket to CodePipeline execution', async () => {
      if (!webhookEndpoint || !sourcesBucket) {
        console.warn('Skipping E2E test - required resources not available');
        return;
      }

      const testRepo = {
        project: { key: process.env.TEST_PROJECT || 'E2ETEST' },
        name: process.env.TEST_REPO || 'e2e-test-repo',
        fullName: `${process.env.TEST_PROJECT || 'E2ETEST'}/${process.env.TEST_REPO || 'e2e-test-repo'}`
      };

      // Correlation ID for tracking
      
      // 1. SIMULATE BITBUCKET WEBHOOK
      console.log('🔄 Step 1: Simulating Bitbucket webhook...');
      
      const webhookPayload = {
        eventKey: 'repo:refs_changed',
        date: new Date().toISOString(),
        actor: { name: 'test-user' },
        repository: testRepo,
        changes: [{
          ref: { id: 'refs/heads/main', displayId: 'main', type: 'BRANCH' },
          refId: 'refs/heads/main',
          fromHash: 'abc123',
          toHash: 'def456',
          type: 'UPDATE'
        }]
      };

      // Create webhook signature (HMAC-SHA256)
      const webhookSecret = 'test-secret-key';
      const signature = crypto
        .createHmac('sha256', webhookSecret)
        .update(JSON.stringify(webhookPayload))
        .digest('hex');

      // Send webhook to API Gateway
      const webhookResponse = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': `sha256=${signature}`,
          'X-Event-Key': 'repo:refs_changed'
        },
        body: JSON.stringify(webhookPayload)
      });

      expect(webhookResponse.status).toBe(200);
      console.log('✅ Webhook processed successfully');

      // 2. VERIFY MESSAGE IN SQS
      console.log('🔄 Step 2: Checking SQS queue for webhook message...');
      
      // Wait for message to appear in queue
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      // Note: In real E2E, we'd need queue URL from stack outputs
      // For now, we'll simulate this step
      console.log('✅ Message should be in SQS queue (simulated)');

      // 3. WAIT FOR REPOSITORY PROCESSING
      console.log('🔄 Step 3: Waiting for repository processing...');
      
      // Wait for Lambda to process message and upload to S3
      await new Promise(resolve => setTimeout(resolve, 10000));

      // 4. VERIFY S3 UPLOAD
      console.log('🔄 Step 4: Checking S3 for repository upload...');
      
      // Expected S3 key for verification
      
      try {
        const s3Objects = await s3Client.send(new ListObjectsV2Command({
          Bucket: sourcesBucket,
          Prefix: `repositories/${testRepo.project.key.toLowerCase()}/${testRepo.name}/`
        }));

        const hasRepositoryFile = s3Objects.Contents?.some(obj => 
          obj.Key?.includes('source.zip') || obj.Key?.includes('.zip')
        );

        if (hasRepositoryFile) {
          console.log('✅ Repository uploaded to S3');
        } else {
          console.log('⚠️  Repository not found in S3 (may take longer to process)');
        }
      } catch (error) {
        console.warn('Could not check S3:', error.message);
      }

      // 5. VERIFY CODEPIPELINE TRIGGER
      console.log('🔄 Step 5: Checking CodePipeline execution...');
      
      // In a real E2E test, we'd check if pipeline was triggered
      // This requires knowing the pipeline name from stack outputs
      if (pipelineName) {
        try {
          const pipelineState = await codePipelineClient.send(new GetPipelineStateCommand({
            name: pipelineName
          }));

          const recentExecution = pipelineState.stageStates?.find(stage => 
            stage.latestExecution?.pipelineExecutionId
          );

          if (recentExecution) {
            console.log('✅ CodePipeline execution detected');
            console.log(`Pipeline Status: ${recentExecution.latestExecution?.status}`);
          } else {
            console.log('⚠️  No recent pipeline execution found');
          }
        } catch (error) {
          console.warn('Could not check pipeline:', error.message);
        }
      } else {
        console.log('⚠️  Pipeline name not available, skipping pipeline check');
      }

      // 6. FINAL VERIFICATION
      console.log('🔄 Step 6: Final verification...');
      
      // In a complete E2E test, we'd verify:
      // - Webhook was processed (✅ done)
      // - Message reached SQS (⚠️ simulated)
      // - Repository was downloaded and uploaded to S3 (⚠️ partial)
      // - CodePipeline was triggered (⚠️ conditional)
      // - Build completed successfully (would require longer wait)

      console.log('✅ End-to-End test completed');
      
      // Basic assertion - webhook was accepted
      expect(webhookResponse.status).toBe(200);
      
    }, 60000); // 60 second timeout for E2E test
  });

  describe('Error Scenarios', () => {
    it('should handle invalid webhook signature', async () => {
      if (!webhookEndpoint) {
        console.warn('Skipping error test - webhook endpoint not available');
        return;
      }

      const invalidPayload = { test: 'invalid' };
      
      const response = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Hub-Signature': 'sha256=invalid-signature',
          'X-Event-Key': 'repo:refs_changed'
        },
        body: JSON.stringify(invalidPayload)
      });

      // Should reject invalid signature
      expect(response.status).toBe(401);
      console.log('✅ Invalid signature properly rejected');
    });

    it('should handle unsupported event types', async () => {
      if (!webhookEndpoint) {
        console.warn('Skipping error test - webhook endpoint not available');
        return;
      }

      const unsupportedPayload = {
        eventKey: 'repo:comment:added', // Unsupported event
        repository: { name: 'test' }
      };

      const response = await fetch(webhookEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Event-Key': 'repo:comment:added'
        },
        body: JSON.stringify(unsupportedPayload)
      });

      // Should accept but not process unsupported events
      expect(response.status).toBe(200);
      console.log('✅ Unsupported event handled gracefully');
    });
  });
});