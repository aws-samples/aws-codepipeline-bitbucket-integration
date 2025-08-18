#!/usr/bin/env node

import 'source-map-support/register.js';
import { App } from 'aws-cdk-lib';
import { BitbucketIntegrationV2EnhancedStack } from '../bitbucket-integration-v2-stack-enhanced.js';

const app = new App();

// Get environment from context
const envName = app.node.tryGetContext('deployEnv') || app.node.tryGetContext('environment') || 'dev';
const stackName = `BitbucketIntegrationV2Stack-${envName}`;

// Get Bitbucket server URL from context or environment variable
const bitbucketServerUrl = app.node.tryGetContext('bitbucketServerUrl') || process.env.BITBUCKET_SERVER_URL;

// Validate that bitbucketServerUrl is provided
if (!bitbucketServerUrl) {
  throw new Error('Bitbucket server URL must be specified via context (--context bitbucketServerUrl=URL) or BITBUCKET_SERVER_URL environment variable');
}

// Get environment configuration
const account = process.env.CDK_DEFAULT_ACCOUNT || process.env.AWS_ACCOUNT_ID;

if (!account) {
  throw new Error('AWS account ID must be specified via CDK_DEFAULT_ACCOUNT or AWS_ACCOUNT_ID environment variable');
}

// Debug region information
console.log('=== CDK App Debug Info ===');
console.log('- Account:', account);
console.log('- Environment:', envName);
console.log('- AWS_DEFAULT_REGION:', process.env.AWS_DEFAULT_REGION || 'not set');
console.log('- CDK_DEFAULT_REGION:', process.env.CDK_DEFAULT_REGION || 'not set');
console.log('- CLI Region will be used via --region parameter');
console.log('==========================');

// Stack configuration - let CDK CLI handle region via --region parameter
const stackProps = {
  env: {
    account: account,
    // Region is handled by CDK CLI --region parameter
  },
  description: `Bitbucket Integration V2 - ${envName} environment`,
  tags: {
    Project: 'BitbucketIntegration',
    Version: '2.0.0',
    Environment: envName,
    Owner: 'alexros@amazon.com'
  },
  envName: envName,
  bitbucketServerUrl: bitbucketServerUrl
};

// Create the main stack
new BitbucketIntegrationV2EnhancedStack(app, stackName, stackProps);
