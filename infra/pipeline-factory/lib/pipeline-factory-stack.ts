import * as cdk from 'aws-cdk-lib';
import * as codepipeline from 'aws-cdk-lib/aws-codepipeline';
import * as codepipeline_actions from 'aws-cdk-lib/aws-codepipeline-actions';
import * as codebuild from 'aws-cdk-lib/aws-codebuild';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { Construct } from 'constructs';

export interface PipelineFactoryStackProps extends cdk.StackProps {
  pipelineName: string;
  repositoryKey: string;
  branch: string;
  sourceBucket: string;
  artifactsBucket: string;
  environment?: string;
  projectWithPrefix?: string;
  repoWithPrefix?: string;
  uniqueSuffix?: string;
}

export class PipelineFactoryStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props: PipelineFactoryStackProps) {
    super(scope, id, props);

    const { 
      pipelineName, 
      repositoryKey, 
      branch, 
      sourceBucket,
      artifactsBucket, 
      environment = 'dev',
      projectWithPrefix,
      repoWithPrefix,
      uniqueSuffix: providedSuffix
    } = props;

    // Create webhook secret for this repository
    const webhookSecret = new secretsmanager.Secret(this, 'WebhookSecret', {
      secretName: `bitbucket-integration-v2/${environment}/webhook-secret/${repositoryKey}`,
      description: `Webhook secret for repository ${repositoryKey}`,
      generateSecretString: {
        secretStringTemplate: JSON.stringify({ secret: '' }),
        generateStringKey: 'secret',
        excludeCharacters: '"@/\\',
        passwordLength: 64
      }
    });

    // Import existing S3 buckets
    const sourceS3Bucket = s3.Bucket.fromBucketName(this, 'SourceBucket', sourceBucket);
    const artifactsS3Bucket = s3.Bucket.fromBucketName(this, 'ArtifactsBucket', artifactsBucket);

    // Determine resource naming based on provided prefixes or fallback to original naming
    let resourcePrefix: string;
    if (projectWithPrefix && repoWithPrefix) {
      resourcePrefix = `${projectWithPrefix}-${repoWithPrefix}`;
    } else {
      // Extract and sanitize components from repositoryKey if prefixes not provided
      const [project, repo] = repositoryKey.split('/');
      
      // Function to simplify names
      const simplifyName = (name: string): string => {
        return name.replace(/[^a-zA-Z0-9]/g, '');
      };
      
      const simplifiedProject = simplifyName(project || 'default');
      const simplifiedRepo = simplifyName(repo || 'repo');
      
      resourcePrefix = `Proj${simplifiedProject}-Repo${simplifiedRepo}`;
    }
    
    // Generate names for resources without suffix
    const uniquePipelineName = `${resourcePrefix}-Pipeline`;
    
    // CodeBuild project with unique name
    const buildProject = new codebuild.Project(this, 'BuildProject', {
      projectName: `${resourcePrefix}-Build`,
      environment: {
        buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
        computeType: codebuild.ComputeType.SMALL,
      },
      buildSpec: codebuild.BuildSpec.fromObject({
        version: '0.2',
        phases: {
          pre_build: {
            commands: [
              'echo Build started on `date`',
              'ls -la',
            ],
          },
          build: {
            commands: [
              'echo Compiling the source code...',
              '# Add your build commands here',
              'echo "Build completed successfully"',
            ],
          },
          post_build: {
            commands: [
              'echo Build completed on `date`',
            ],
          },
        },
        artifacts: {
          files: [
            '**/*',
          ],
        },
      }),
    });

    // Grant permissions to read from source bucket
    sourceS3Bucket.grantRead(buildProject);

    // Create artifacts
    const sourceOutput = new codepipeline.Artifact('SourceOutput');
    const buildOutput = new codepipeline.Artifact('BuildOutput');

    // Sanitize S3 key components to match repository-processor logic
    const sanitizeS3KeyComponent = (component: string): string => {
      return component
        .replace(/[^a-zA-Z0-9\-_.]/g, '-') // Replace invalid chars with dash
        .replace(/-+/g, '-')               // Replace multiple dashes with single dash
        .replace(/^-|-$/g, '')             // Remove leading/trailing dashes
        .toLowerCase();
    };

    // Extract components from repositoryKey (assuming format: project/repo)
    const [project, repo] = repositoryKey.split('/');

    // Use sanitized components to build bucketKey
    const bucketKey = `repositories/${sanitizeS3KeyComponent(project)}/${sanitizeS3KeyComponent(repo)}/${sanitizeS3KeyComponent(branch)}/source.zip`;

    // Create pipeline
    const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
      pipelineName: uniquePipelineName,
      artifactBucket: artifactsS3Bucket,
      stages: [
        {
          stageName: 'Source',
          actions: [
            new codepipeline_actions.S3SourceAction({
              actionName: 'S3Source',
              bucket: sourceS3Bucket,
              bucketKey: bucketKey,
              output: sourceOutput,
              // Lambda triggers pipeline manually, no S3 trigger needed
              trigger: codepipeline_actions.S3Trigger.EVENTS,
            }),
          ],
        },
        {
          stageName: 'Build',
          actions: [
            new codepipeline_actions.CodeBuildAction({
              actionName: 'CodeBuild',
              project: buildProject,
              input: sourceOutput,
              outputs: [buildOutput],
            }),
          ],
        },
      ],
    });

    // Outputs
    new cdk.CfnOutput(this, 'PipelineName', {
      value: pipeline.pipelineName,
      description: 'Name of the created pipeline',
    });

    new cdk.CfnOutput(this, 'PipelineArn', {
      value: pipeline.pipelineArn,
      description: 'ARN of the created pipeline',
    });

    new cdk.CfnOutput(this, 'BuildProjectName', {
      value: buildProject.projectName,
      description: 'Name of the CodeBuild project',
    });

    new cdk.CfnOutput(this, 'WebhookSecretName', {
      value: webhookSecret.secretName,
      description: 'Name of the webhook secret for this repository',
    });
  }
}
