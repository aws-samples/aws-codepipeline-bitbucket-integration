# Bitbucket Integration V2 - Infrastructure

This directory contains the AWS CDK infrastructure code for the refactored Bitbucket Integration V2 solution.

## Architecture Overview

The V2 architecture implements a serverless, event-driven design with improved scalability, observability, and maintainability:

- **API Gateway**: Receives webhook events from Bitbucket
- **Webhook Handler Lambda**: Validates and processes webhook events, sends messages to SQS
- **SQS Queue**: Decouples webhook processing from repository processing
- **Repository Processor Lambda**: Downloads repositories from Bitbucket and uploads to S3
- **S3 Bucket**: Stores repository archives with lifecycle management
- **CloudWatch**: Comprehensive monitoring and alerting
- **Secrets Manager**: Secure credential storage

## Key Improvements from V1

1. **Decoupled Architecture**: SQS queue separates webhook handling from repository processing
2. **Better Error Handling**: Dead Letter Queue (DLQ) for failed messages
3. **Enhanced Observability**: Structured logging, custom metrics, and CloudWatch dashboard
4. **Improved Security**: Secrets Manager integration, IAM least privilege
5. **Scalability**: Independent scaling of webhook handler and repository processor
6. **Reliability**: Retry logic, circuit breakers, and graceful degradation

## Prerequisites

- Node.js 20.x or later
- AWS CDK CLI v2.147.0 or later
- AWS CLI configured with appropriate permissions
- Bitbucket Server instance with accessible endpoint

## Deployment

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment

Ensure your AWS credentials are configured:

```bash
aws configure
```

### 3. Bootstrap CDK (if first time)

```bash
npx cdk bootstrap
```

### 4. Deploy Infrastructure

```bash
npx cdk deploy
```

### 5. Configure Secrets

After deployment, update the secrets with actual values:

```bash
# Update Bitbucket token
aws secretsmanager update-secret \
  --secret-id bitbucket-integration-v2/token \
  --secret-string '{"token":"your-bitbucket-token"}'

# Update webhook secret
aws secretsmanager update-secret \
  --secret-id bitbucket-integration-v2/webhook-secret \
  --secret-string '{"secret":"your-webhook-secret"}'
```

### 6. Configure Bitbucket Webhook

Use the webhook endpoint URL from the deployment output to configure your Bitbucket webhook:

1. Go to your Bitbucket repository settings
2. Navigate to Webhooks
3. Add a new webhook with the endpoint URL
4. Select "Repository push" events
5. Set the secret to match the value in Secrets Manager

## Monitoring and Observability

### CloudWatch Dashboard

The deployment creates a comprehensive dashboard showing:

- Webhook processing metrics
- Repository processing metrics
- SQS queue metrics
- Error rates and latencies

### Custom Metrics

The solution publishes custom metrics to CloudWatch:

- `WebhookProcessed`: Number of webhooks processed
- `RepositoriesProcessed`: Number of repositories processed
- `ProcessingErrors`: Number of processing errors
- `WebhookProcessingTime`: Webhook processing duration
- `TotalProcessingTime`: End-to-end processing duration

### Alarms

Consider setting up CloudWatch alarms for:

- High error rates
- Long processing times
- DLQ message count
- Lambda function errors

## Configuration

### Environment Variables

The Lambda functions use the following environment variables:

#### Webhook Handler
- `BITBUCKET_SECRET`: Secret name for webhook validation
- `SQS_QUEUE_URL`: SQS queue URL for repository processing
- `LOG_LEVEL`: Logging level (info, debug, warn, error)

#### Repository Processor
- `BITBUCKET_SERVER_URL`: Bitbucket server URL
- `BITBUCKET_TOKEN`: Secret name for Bitbucket authentication
- `S3_BUCKET_NAME`: S3 bucket for repository storage
- `WEBPROXY_HOST`: Proxy host (if required)
- `WEBPROXY_PORT`: Proxy port (if required)

### Scaling Configuration

- **Webhook Handler**: Reserved concurrency of 10
- **Repository Processor**: Reserved concurrency of 5
- **SQS Batch Size**: 10 messages per batch
- **SQS Visibility Timeout**: 6 minutes

## Security

### IAM Permissions

The solution follows the principle of least privilege:

- Webhook Handler can only read webhook secrets and send SQS messages
- Repository Processor can only read token secrets and access S3 bucket
- All CloudWatch metrics are scoped to the BitbucketIntegration namespace

### Encryption

- S3 bucket uses KMS encryption
- SQS queues use KMS encryption
- Secrets Manager uses default encryption
- CloudWatch logs are encrypted

## Troubleshooting

### Common Issues

1. **Webhook validation failures**: Check secret configuration
2. **Repository download failures**: Verify Bitbucket token and network connectivity
3. **S3 upload failures**: Check IAM permissions and bucket configuration
4. **High DLQ message count**: Investigate processing errors in CloudWatch logs

### Debugging

1. Check CloudWatch logs for detailed error messages
2. Monitor custom metrics in CloudWatch dashboard
3. Review DLQ messages for failed processing attempts
4. Use X-Ray tracing for distributed tracing (if enabled)

## Cost Optimization

- S3 lifecycle rules automatically delete old versions after 30 days
- CloudWatch log retention is set to 1 month
- Lambda functions use ARM64 architecture for better price/performance
- Reserved concurrency limits prevent runaway costs

## Cleanup

To remove all resources:

```bash
npx cdk destroy
```

Note: S3 bucket contents will be automatically deleted due to the `autoDeleteObjects` setting.

## Support

For issues or questions:

1. Check CloudWatch logs and metrics
2. Review the troubleshooting section
3. Contact the development team

## Version History

- **V2.0.0**: Initial refactored architecture with improved scalability and observability
- **V1.0.0**: Original monolithic Lambda implementation
