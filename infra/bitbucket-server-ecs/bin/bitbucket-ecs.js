#!/usr/bin/env node

import 'source-map-support/register.js';
import * as cdk from 'aws-cdk-lib';
import { BitbucketEcsStack } from '../lib/bitbucket-ecs-stack.js';

const app = new cdk.App();

// Get environment from context
const envName = app.node.tryGetContext('environment') || 'dev';
const stackName = `BitbucketServerEcsStack-${envName}`;

// Get environment configuration
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;
const region = process.env.CDK_DEFAULT_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';

if (!account) {
  throw new Error('AWS account ID must be specified via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable');
}

// Stack configuration
const stackProps = {
  env: {
    account: account,
    region: region
  },
  description: `Bitbucket Server 9.3.2 on AWS ECS Fargate - ${envName} environment`,
  tags: {
    Project: 'BitbucketServerECS',
    Environment: envName,
    ManagedBy: 'AWS-CDK',
    Version: '9.3.2',
    CostCenter: 'Development-Tools'
  },
  envName: envName
};

// Create the main stack
new BitbucketEcsStack(app, stackName, stackProps);

// Add stack-level tags
cdk.Tags.of(app).add('Application', 'Bitbucket-Server');
cdk.Tags.of(app).add('Platform', 'ECS-Fargate');
cdk.Tags.of(app).add('Repository', 'aws-codepipeline-bitbucket-integration');
