import { Stack, Duration, RemovalPolicy, CfnOutput, Fn, DockerImage } from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as sqs from 'aws-cdk-lib/aws-sqs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import { SqsEventSource } from 'aws-cdk-lib/aws-lambda-event-sources';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export class BitbucketIntegrationV2EnhancedStack extends Stack {
  /**
   * @param {Construct} scope
   * @param {string} id
   * @param {StackProps=} props
   * @param {string} environment
   */
  constructor(scope, id, props) {
    super(scope, id, props);
    
    this.envName = props.envName || 'dev';
    
    // Get the actual region being used by this stack
    const stackRegion = Stack.of(this).region;
    this.account = Stack.of(this).account;
    this.region = stackRegion;
    
    // Debug output for region resolution
    console.log('=== Stack Region Debug ===');
    console.log('Stack region:', stackRegion);
    console.log('Props env:', props.env);
    console.log('AWS_DEFAULT_REGION:', process.env.AWS_DEFAULT_REGION);
    console.log('CDK_DEFAULT_REGION:', process.env.CDK_DEFAULT_REGION);
    console.log('========================');
    
    // Note: Region validation removed because CDK tokens cannot be compared directly
    // during construction phase. The region is properly set via environment variables
    // and CDK deployment parameters, so validation is not needed here.
    
    // Require bitbucketServerUrl parameter
    if (!props.bitbucketServerUrl) {
      throw new Error('bitbucketServerUrl is required in stack properties');
    }
    
    this.bitbucketServerUrl = props.bitbucketServerUrl;
    
    // Validate and get Bitbucket Server URL
    const bitbucketServerUrl = this.getBitbucketServerUrl();

    // Create S3 buckets
    const { artifactsBucket, sourcesBucket } = this.createS3Buckets();

    // Create DynamoDB table for repository-pipeline mappings
    const repositoryMappingTable = this.createDynamoDBTable();

    // Create SQS queues
    const { processingQueue, deadLetterQueue } = this.createSQSQueues();

    // Create secrets
    const { bitbucketToken } = this.createSecrets();

    // Create Lambda functions
    const { webhookHandler, repositoryProcessor } = this.createLambdaFunctions(
      bitbucketServerUrl,
      sourcesBucket,
      processingQueue,
      deadLetterQueue,
      bitbucketToken,
      repositoryMappingTable
    );

    // Create API Gateway
    const apiGateway = this.createAPIGateway(webhookHandler);



    // Configure permissions
    this.configurePermissions(
      webhookHandler,
      repositoryProcessor,
      bitbucketToken,
      processingQueue,
      sourcesBucket,
      artifactsBucket,
      repositoryMappingTable
    );

    // Create monitoring
    this.createMonitoring(processingQueue, deadLetterQueue);

    // Create outputs
    this.createOutputs(
      apiGateway,
      sourcesBucket,
      artifactsBucket,
      processingQueue,
      deadLetterQueue,
      bitbucketToken,
      repositoryMappingTable
    );
  }

  /**
   * Validates and returns the Bitbucket Server URL.
   * The URL must be provided as a stack parameter and must be a valid HTTP/HTTPS URL.
   * 
   * @returns {string} The validated Bitbucket Server URL
   * @throws {Error} If the URL is invalid
   */
  getBitbucketServerUrl() {
    // Validate URL format
    const urlPattern = /^https?:\/\/.+/i;
    if (!urlPattern.test(this.bitbucketServerUrl)) {
      throw new Error(`Invalid Bitbucket server URL: ${this.bitbucketServerUrl}. URL must start with http:// or https://`);
    }
    return this.bitbucketServerUrl;
  }

  createS3Buckets() {
    // Artifacts bucket for CodePipeline
    const artifactsBucket = new s3.Bucket(this, 'CodePipelineArtifacts', {
      bucketName: `bitbucket-codepipeline-artifacts-${this.envName}-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      lifecycleRules: [
        {
          id: 'DeleteOldArtifacts',
          enabled: true,
          expiration: Duration.days(30)
        }
      ]
    });

    // Sources bucket for repository storage
    const sourcesBucket = new s3.Bucket(this, 'BitbucketSources', {
      bucketName: `bitbucket-sources-${this.envName}-${this.account}-${this.region}`,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
      versioned: true,
      encryption: s3.BucketEncryption.KMS_MANAGED,
      lifecycleRules: [
        {
          id: 'DeleteOldVersions',
          enabled: true,
          noncurrentVersionExpiration: Duration.days(30)
        }
      ]
    });

    return { artifactsBucket, sourcesBucket };
  }

  createDynamoDBTable() {
    const repositoryMappingTable = new dynamodb.Table(this, 'RepositoryMappingTable', {
      tableName: `bitbucket-repository-mappings-${this.envName}`,
      partitionKey: {
        name: 'repositoryKey',
        type: dynamodb.AttributeType.STRING
      },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      encryption: dynamodb.TableEncryption.AWS_MANAGED,
      removalPolicy: RemovalPolicy.DESTROY,
      pointInTimeRecovery: true
    });

    return repositoryMappingTable;
  }

  createSQSQueues() {
    // Dead Letter Queue
    const deadLetterQueue = new sqs.Queue(this, 'BitbucketIntegrationDLQ', {
      queueName: `bitbucket-integration-v2-dlq-${this.envName}`,
      retentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED
    });

    // Main processing queue
    const processingQueue = new sqs.Queue(this, 'BitbucketIntegrationQueue', {
      queueName: `bitbucket-integration-v2-queue-${this.envName}`,
      visibilityTimeout: Duration.minutes(6),
      messageRetentionPeriod: Duration.days(14),
      encryption: sqs.QueueEncryption.KMS_MANAGED,
      deadLetterQueue: {
        queue: deadLetterQueue,
        maxReceiveCount: 3
      }
    });

    return { processingQueue, deadLetterQueue };
  }

  createSecrets() {
    // Bitbucket access token
    const bitbucketToken = new secretsmanager.Secret(this, 'BitbucketToken', {
      secretName: `bitbucket-integration-v2/${this.envName}/token`,
      description: 'Bitbucket Server Personal Access Token with ADMIN permissions',
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: 'admin',
          permissions: ['ADMIN', 'PROJECT_ADMIN', 'REPO_ADMIN']
        }),
        generateStringKey: 'token',
        excludeCharacters: '"@/\\'
      }
    });

    return { bitbucketToken };
  }

  createLambdaFunctions(bitbucketServerUrl, sourcesBucket, processingQueue, deadLetterQueue, bitbucketToken, repositoryMappingTable) {
    // CloudWatch Log Groups
    const webhookLogGroup = new logs.LogGroup(this, 'WebhookHandlerLogGroup', {
      logGroupName: '/aws/lambda/bitbucket-webhook-handler-v2',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    const processorLogGroup = new logs.LogGroup(this, 'RepositoryProcessorLogGroup', {
      logGroupName: '/aws/lambda/bitbucket-repository-processor-v2',
      retention: logs.RetentionDays.ONE_MONTH,
      removalPolicy: RemovalPolicy.DESTROY
    });

    // Criar camada Lambda para módulos compartilhados
    const sharedLayer = new lambda.LayerVersion(this, 'BitbucketSharedLayer', {
      layerVersionName: 'bitbucket-integration-shared-layer',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/bitbucket-integration-v2/shared-layer')),
      compatibleRuntimes: [lambda.Runtime.NODEJS_20_X], // Usar uma versão compatível disponível
      description: 'Shared utilities for Bitbucket integration with Node.js',
      license: 'MIT'
    });

    // Webhook Handler Lambda
    const webhookHandler = new lambda.Function(this, 'WebhookHandler', {
      functionName: `bitbucket-webhook-handler-v2-${this.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/bitbucket-integration-v2/webhook-handler')),
      timeout: Duration.seconds(30),
      memorySize: 256,
      environment: {
        SQS_QUEUE_URL: processingQueue.queueUrl,
        ENVIRONMENT: this.envName,
        LOG_LEVEL: 'info',
        SERVICE_VERSION: '2.0.0'
      },
      logGroup: webhookLogGroup,
      reservedConcurrentExecutions: 10,
      deadLetterQueue: deadLetterQueue,
      layers: [sharedLayer]
    });

    // Repository Processor Lambda
    const repositoryProcessor = new lambda.Function(this, 'RepositoryProcessor', {
      functionName: `bitbucket-repository-processor-v2-${this.envName}`,
      runtime: lambda.Runtime.NODEJS_20_X,
      handler: 'index.handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../../app/bitbucket-integration-v2/repository-processor')),
      timeout: Duration.minutes(5),
      memorySize: 1024,
      environment: {
        BITBUCKET_SERVER_URL: bitbucketServerUrl,
        BITBUCKET_TOKEN: bitbucketToken.secretName,
        S3_BUCKET_NAME: sourcesBucket.bucketName,
        DYNAMODB_TABLE_NAME: repositoryMappingTable.tableName,
        LOG_LEVEL: 'info',
        SERVICE_VERSION: '2.0.0'
      },
      logGroup: processorLogGroup,
      reservedConcurrentExecutions: 5,
      deadLetterQueue: deadLetterQueue,
      layers: [sharedLayer]
    });

    // Configure SQS event source
    repositoryProcessor.addEventSource(new SqsEventSource(processingQueue, {
      batchSize: 10,
      maxBatchingWindow: Duration.seconds(5),
      reportBatchItemFailures: true
    }));

    return { webhookHandler, repositoryProcessor };
  }

  createAPIGateway(webhookHandler) {
    const apiGateway = new apigateway.RestApi(this, 'BitbucketIntegrationAPI', {
      restApiName: `bitbucket-integration-v2-api-${this.envName}`,
      description: 'Bitbucket Integration V2 API Gateway',
      cloudWatchRole: true,
      deployOptions: {
        stageName: this.envName,
        loggingLevel: apigateway.MethodLoggingLevel.INFO,
        dataTraceEnabled: true,
        metricsEnabled: true,
        throttlingRateLimit: 100,
        throttlingBurstLimit: 200
      },
      endpointConfiguration: {
        types: [apigateway.EndpointType.REGIONAL]
      },
      defaultCorsPreflightOptions: {
        allowOrigins: apigateway.Cors.ALL_ORIGINS,
        allowMethods: apigateway.Cors.ALL_METHODS,
        allowHeaders: ['Content-Type', 'X-Amz-Date', 'Authorization', 'X-Api-Key', 'X-Amz-Security-Token', 'X-Hub-Signature']
      }
    });

    // Add webhook endpoint
    const webhookResource = apiGateway.root.addResource('webhook');
    webhookResource.addMethod('POST', new apigateway.LambdaIntegration(webhookHandler, {
      proxy: true
    }));

    // Grant API Gateway permission to invoke webhook handler
    webhookHandler.grantInvoke(new iam.ServicePrincipal('apigateway.amazonaws.com'));

    return apiGateway;
  }



  configurePermissions(webhookHandler, repositoryProcessor, bitbucketToken, processingQueue, sourcesBucket, artifactsBucket, repositoryMappingTable) {
    // Webhook Handler permissions
    webhookHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [`arn:aws:secretsmanager:${this.region}:${this.account}:secret:bitbucket-integration-v2*`]
    }));

    webhookHandler.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['sqs:SendMessage', 'sqs:GetQueueAttributes'],
      resources: [processingQueue.queueArn]
    }));

    // Repository Processor permissions
    repositoryProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['secretsmanager:GetSecretValue'],
      resources: [bitbucketToken.secretArn]
    }));

    repositoryProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        's3:PutObject',
        's3:PutObjectAcl',
        's3:GetObject',
        's3:HeadObject',
        's3:ListBucket'
      ],
      resources: [
        sourcesBucket.bucketArn,
        `${sourcesBucket.bucketArn}/*`,
        artifactsBucket.bucketArn,
        `${artifactsBucket.bucketArn}/*`
      ]
    }));



    repositoryProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'sqs:ReceiveMessage',
        'sqs:DeleteMessage',
        'sqs:GetQueueAttributes'
      ],
      resources: [processingQueue.queueArn]
    }));

    repositoryProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: ['dynamodb:GetItem'],
      resources: [repositoryMappingTable.tableArn]
    }));

    repositoryProcessor.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'codepipeline:StartPipelineExecution',
        'codepipeline:GetPipelineState',
        'codepipeline:GetPipelineExecution'
      ],
      resources: [`arn:aws:codepipeline:${this.region}:${this.account}:*`]
    }));

    // CloudWatch metrics permissions
    [webhookHandler, repositoryProcessor].forEach(func => {
      func.addToRolePolicy(new iam.PolicyStatement({
        effect: iam.Effect.ALLOW,
        actions: ['cloudwatch:PutMetricData'],
        resources: ['*'],
        conditions: {
          StringEquals: {
            'cloudwatch:namespace': 'BitbucketIntegration'
          }
        }
      }));
    });
  }

  createMonitoring(processingQueue, deadLetterQueue) {
    const dashboard = new cloudwatch.Dashboard(this, 'BitbucketIntegrationDashboard', {
      dashboardName: `BitbucketIntegration-V2-Enhanced-${this.envName}`,
      widgets: [
        [
          new cloudwatch.GraphWidget({
            title: 'Webhook Processing',
            left: [
              new cloudwatch.Metric({
                namespace: 'BitbucketIntegration',
                metricName: 'WebhookProcessed',
                statistic: 'Sum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'BitbucketIntegration',
                metricName: 'WebhookErrors',
                statistic: 'Sum'
              })
            ]
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Repository Processing',
            left: [
              new cloudwatch.Metric({
                namespace: 'BitbucketIntegration',
                metricName: 'RepositoriesProcessed',
                statistic: 'Sum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'BitbucketIntegration',
                metricName: 'PipelineTriggered',
                statistic: 'Sum'
              })
            ]
          })
        ],
        [
          new cloudwatch.GraphWidget({
            title: 'Queue Metrics',
            left: [
              new cloudwatch.Metric({
                namespace: 'AWS/SQS',
                metricName: 'ApproximateNumberOfMessagesVisible',
                dimensions: { QueueName: processingQueue.queueName },
                statistic: 'Average'
              }),
              new cloudwatch.Metric({
                namespace: 'AWS/SQS',
                metricName: 'ApproximateAgeOfOldestMessage',
                dimensions: { QueueName: processingQueue.queueName },
                statistic: 'Maximum'
              })
            ],
            right: [
              new cloudwatch.Metric({
                namespace: 'AWS/SQS',
                metricName: 'ApproximateNumberOfMessagesVisible',
                dimensions: { QueueName: deadLetterQueue.queueName },
                statistic: 'Average'
              })
            ]
          })
        ]
      ]
    });

    return dashboard;
  }

  createOutputs(apiGateway, sourcesBucket, artifactsBucket, processingQueue, deadLetterQueue, bitbucketToken, repositoryMappingTable) {
    new CfnOutput(this, 'WebhookEndpoint', {
      value: `${apiGateway.url}webhook`,
      description: 'Bitbucket Webhook Endpoint URL - Configure this in Bitbucket Server'
    });

    new CfnOutput(this, 'SourcesBucketName', {
      value: sourcesBucket.bucketName,
      description: 'S3 Bucket for Repository Sources'
    });

    new CfnOutput(this, 'ArtifactsBucketName', {
      value: artifactsBucket.bucketName,
      description: 'S3 Bucket for CodePipeline Artifacts'
    });

    new CfnOutput(this, 'BitbucketTokenSecretName', {
      value: bitbucketToken.secretName,
      description: 'Bitbucket Token Secret Name - Update with your personal access token'
    });

    new CfnOutput(this, 'RepositoryMappingTableName', {
      value: repositoryMappingTable.tableName,
      description: 'DynamoDB table for repository-pipeline mappings'
    });

    new CfnOutput(this, 'SetupInstructions', {
      value: 'https://github.com/your-repo/bitbucket-integration#setup',
      description: 'Setup Instructions URL'
    });
  }
}
