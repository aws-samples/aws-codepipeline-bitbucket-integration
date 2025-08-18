import { describe, it } from '@jest/globals';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { App } from 'aws-cdk-lib';
import { PipelineFactoryStack } from '../../../infra/pipeline-factory/lib/pipeline-factory-stack';

describe('PipelineFactoryStack Tests', () => {
  const testProps = {
    pipelineName: 'test-pipeline',
    repositoryKey: 'TEST/test-repo',
    branch: 'main',
    sourceBucket: 'test-source-bucket',
    artifactsBucket: 'test-artifacts-bucket',
    environment: 'test'
  };

  it('should create a CodePipeline with correct stages', () => {
    const app = new App();
    const stack = new PipelineFactoryStack(app, 'TestPipelineFactoryStack', testProps);
    const template = Template.fromStack(stack);

    // Verify CodePipeline is created
    template.resourceCountIs('AWS::CodePipeline::Pipeline', 1);
    
    // Verify pipeline has Source and Build stages
    template.hasResourceProperties('AWS::CodePipeline::Pipeline', {
      Stages: [
        {
          Name: 'Source',
          Actions: [
            {
              Name: 'S3Source',
              ActionTypeId: {
                Category: 'Source',
                Provider: 'S3'
              }
            }
          ]
        },
        {
          Name: 'Build',
          Actions: [
            {
              Name: 'CodeBuild',
              ActionTypeId: {
                Category: 'Build',
                Provider: 'CodeBuild'
              }
            }
          ]
        }
      ]
    });
  });

  it('should create a CodeBuild project', () => {
    const app = new App();
    const stack = new PipelineFactoryStack(app, 'TestPipelineFactoryStack', testProps);
    const template = Template.fromStack(stack);

    // Verify CodeBuild project is created
    template.resourceCountIs('AWS::CodeBuild::Project', 1);
    
    // Verify CodeBuild project has correct properties
    template.hasResourceProperties('AWS::CodeBuild::Project', {
      Name: Match.stringLikeRegexp('Proj.*-Repo.*-Build'),
      Environment: {
        Type: 'LINUX_CONTAINER',
        ComputeType: 'BUILD_GENERAL1_SMALL'
      }
    });
  });

  it('should create a webhook secret in Secrets Manager', () => {
    const app = new App();
    const stack = new PipelineFactoryStack(app, 'TestPipelineFactoryStack', testProps);
    const template = Template.fromStack(stack);

    // Verify Secret is created
    template.resourceCountIs('AWS::SecretsManager::Secret', 1);
    
    // Verify Secret has correct name
    template.hasResourceProperties('AWS::SecretsManager::Secret', {
      Name: `bitbucket-integration-v2/${testProps.environment}/webhook-secret/${testProps.repositoryKey}`,
      Description: `Webhook secret for repository ${testProps.repositoryKey}`,
      GenerateSecretString: {
        SecretStringTemplate: '{"secret":""}',
        GenerateStringKey: 'secret',
        ExcludeCharacters: '"@/\\',
        PasswordLength: 64
      }
    });
  });

  it('should output pipeline details', () => {
    const app = new App();
    const stack = new PipelineFactoryStack(app, 'TestPipelineFactoryStack', testProps);
    const template = Template.fromStack(stack);

    // Verify outputs are created
    template.hasOutput('PipelineName', {});
    template.hasOutput('PipelineArn', {});
    template.hasOutput('BuildProjectName', {});
    template.hasOutput('WebhookSecretName', {});
  });
});
