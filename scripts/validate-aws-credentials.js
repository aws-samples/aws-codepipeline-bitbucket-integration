#!/usr/bin/env node

/**
 * AWS Credentials Validation Script
 * 
 * This script validates AWS credentials and shows detailed information about
 * which credentials are being used, their type, and tests connectivity to
 * AWS services required by this project.
 * 
 * Usage:
 *   node scripts/validate-aws-credentials.js [region]
 *   npm run validate:aws
 */

import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { CodePipelineClient, ListPipelinesCommand } from '@aws-sdk/client-codepipeline';
import { CloudWatchLogsClient, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m'
};

function colorize(text, color) {
  return `${colors[color]}${text}${colors.reset}`;
}

function log(message, color = 'reset') {
  console.log(colorize(message, color));
}

function logSection(title) {
  console.log('\n' + colorize('='.repeat(60), 'cyan'));
  console.log(colorize(`  ${title}`, 'bright'));
  console.log(colorize('='.repeat(60), 'cyan'));
}

function logSubsection(title) {
  console.log('\n' + colorize(`📋 ${title}`, 'blue'));
  console.log(colorize('-'.repeat(40), 'blue'));
}

// Function to mask sensitive information
function maskCredential(value) {
  if (!value) return colorize('Not set', 'yellow');
  if (value.length <= 8) return colorize('****', 'green');
  return colorize(`${value.substring(0, 4)}****${value.substring(value.length - 4)}`, 'green');
}

// Function to load credentials from E2E credentials file
function loadE2ECredentials() {
  const credentialsPath = '/tmp/e2e-credentials.sh';
  
  if (!existsSync(credentialsPath)) {
    return null;
  }
  
  try {
    const fileContent = readFileSync(credentialsPath, 'utf8');
    const variables = {};
    
    // Regex para extrair variáveis no formato: export NAME='value'
    const regex = /export\s+([A-Z0-9_]+)=['"]?(.*?)['"]?$/gm;
    let match;
    
    while ((match = regex.exec(fileContent)) !== null) {
      const [, name, value] = match;
      variables[name] = value;
    }
    
    return variables;
  } catch (error) {
    return null;
  }
}

// Function to show comprehensive AWS configuration debug information
function showAWSConfiguration() {
  logSubsection('Environment Variables');
  
  const awsEnvVars = {
    'AWS_ACCESS_KEY_ID': process.env.AWS_ACCESS_KEY_ID,
    'AWS_SECRET_ACCESS_KEY': process.env.AWS_SECRET_ACCESS_KEY,
    'AWS_SESSION_TOKEN': process.env.AWS_SESSION_TOKEN,
    'AWS_REGION': process.env.AWS_REGION,
    'AWS_DEFAULT_REGION': process.env.AWS_DEFAULT_REGION,
    'AWS_PROFILE': process.env.AWS_PROFILE,
    'AWS_CONFIG_FILE': process.env.AWS_CONFIG_FILE,
    'AWS_SHARED_CREDENTIALS_FILE': process.env.AWS_SHARED_CREDENTIALS_FILE
  };
  
  Object.entries(awsEnvVars).forEach(([key, value]) => {
    const prefix = '  ';
    if (key.includes('KEY') || key.includes('TOKEN')) {
      console.log(`${prefix}${colorize(key, 'cyan')}: ${maskCredential(value)}`);
    } else {
      const displayValue = value || colorize('Not set', 'yellow');
      console.log(`${prefix}${colorize(key, 'cyan')}: ${displayValue}`);
    }
  });

  logSubsection('AWS Configuration Files');
  
  const awsDir = join(homedir(), '.aws');
  const credentialsFile = join(awsDir, 'credentials');
  const configFile = join(awsDir, 'config');
  
  console.log(`  ${colorize('~/.aws/credentials', 'cyan')}: ${existsSync(credentialsFile) ? colorize('✓ Exists', 'green') : colorize('✗ Not found', 'red')}`);
  console.log(`  ${colorize('~/.aws/config', 'cyan')}: ${existsSync(configFile) ? colorize('✓ Exists', 'green') : colorize('✗ Not found', 'red')}`);
  
  // Show credentials file profiles
  if (existsSync(credentialsFile)) {
    try {
      const credContent = readFileSync(credentialsFile, 'utf8');
      const profiles = credContent.match(/\[([^\]]+)\]/g) || [];
      console.log(`  ${colorize('Available profiles', 'cyan')}: ${profiles.join(', ')}`);
      
      // Check credential types
      if (credContent.includes('aws_session_token')) {
        log('  ⚠️  Temporary credentials detected (with session token)', 'yellow');
      }
      if (credContent.includes('aws_access_key_id')) {
        log('  ✓ Long-term credentials detected', 'green');
      }
    } catch (error) {
      log(`  Error reading credentials file: ${error.message}`, 'red');
    }
  }
  
  // Show config file regions
  if (existsSync(configFile)) {
    try {
      const configContent = readFileSync(configFile, 'utf8');
      const regionMatch = configContent.match(/region\s*=\s*([^\s\n]+)/);
      if (regionMatch) {
        console.log(`  ${colorize('Default region (config)', 'cyan')}: ${regionMatch[1]}`);
      }
    } catch (error) {
      log(`  Error reading config file: ${error.message}`, 'red');
    }
  }

  logSubsection('E2E Test Credentials');
  
  const e2eCredentials = loadE2ECredentials();
  if (e2eCredentials) {
    log(`  ✓ E2E credentials file found: /tmp/e2e-credentials.sh`, 'green');
    console.log(`  ${colorize('Variables loaded', 'cyan')}: ${Object.keys(e2eCredentials).length}`);
    
    // Show relevant AWS variables from E2E file
    const relevantVars = ['AWS_TEST_REGION', 'AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_SESSION_TOKEN'];
    relevantVars.forEach(varName => {
      if (e2eCredentials[varName]) {
        if (varName.includes('KEY') || varName.includes('TOKEN')) {
          console.log(`    ${colorize(varName, 'cyan')}: ${maskCredential(e2eCredentials[varName])}`);
        } else {
          console.log(`    ${colorize(varName, 'cyan')}: ${e2eCredentials[varName]}`);
        }
      }
    });
  } else {
    log('  ✗ E2E credentials file not found', 'yellow');
    log('    Run: ./scripts/setup-e2e-test.sh', 'yellow');
  }

  logSubsection('Credential Resolution Order');
  
  console.log('  The AWS SDK resolves credentials in this order:');
  console.log('  1. ' + colorize('Environment variables', 'cyan') + ' (AWS_ACCESS_KEY_ID, etc.)');
  console.log('  2. ' + colorize('Shared credentials file', 'cyan') + ' (~/.aws/credentials)');
  console.log('  3. ' + colorize('ECS container credentials', 'cyan') + ' (if running in ECS)');
  console.log('  4. ' + colorize('EC2 instance metadata', 'cyan') + ' (if running on EC2)');
  console.log('  5. ' + colorize('AWS SSO', 'cyan') + ' (if configured)');
}

// Function to validate AWS credentials
async function validateCredentials(region) {
  logSubsection('Credential Validation');
  
  try {
    const stsClient = new STSClient({ region });
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    
    log('✅ AWS credentials are valid!', 'green');
    console.log(`  ${colorize('Account ID', 'cyan')}: ${identity.Account}`);
    console.log(`  ${colorize('User/Role ARN', 'cyan')}: ${identity.Arn}`);
    console.log(`  ${colorize('User ID', 'cyan')}: ${identity.UserId}`);
    console.log(`  ${colorize('Region', 'cyan')}: ${region}`);
    
    // Determine and display credential type
    let credentialType = 'Unknown';
    let recommendation = '';
    
    if (identity.Arn.includes(':assumed-role/')) {
      credentialType = 'Assumed Role (temporary credentials)';
      recommendation = 'Good for automation and security';
    } else if (identity.Arn.includes(':user/')) {
      credentialType = 'IAM User (long-term credentials)';
      recommendation = 'Consider using temporary credentials for better security';
    } else if (identity.Arn.includes(':root')) {
      credentialType = 'Root Account';
      recommendation = '⚠️  Not recommended for automation - use IAM user or role';
    } else if (identity.Arn.includes(':federated-user/')) {
      credentialType = 'Federated User';
      recommendation = 'Good for temporary access';
    }
    
    console.log(`  ${colorize('Credential Type', 'cyan')}: ${credentialType}`);
    if (recommendation) {
      console.log(`  ${colorize('Recommendation', 'cyan')}: ${recommendation}`);
    }
    
    // Check if credentials are temporary
    if (process.env.AWS_SESSION_TOKEN) {
      log('  ℹ️  Using temporary credentials (session token present)', 'blue');
    }
    
    return { success: true, identity };
  } catch (error) {
    log('❌ AWS credentials validation failed!', 'red');
    console.log(`  ${colorize('Error', 'red')}: ${error.message}`);
    
    // Show attempted configuration
    console.log(`\n  ${colorize('Attempted Configuration:', 'yellow')}`);
    if (process.env.AWS_ACCESS_KEY_ID) {
      console.log(`    Access Key: ${maskCredential(process.env.AWS_ACCESS_KEY_ID)} (from environment)`);
    }
    if (process.env.AWS_SESSION_TOKEN) {
      console.log('    Session Token: Present (temporary credentials)');
    }
    console.log(`    Region: ${region}`);
    
    // Provide specific solutions based on error type
    console.log(`\n  ${colorize('💡 Solutions:', 'yellow')}`);
    
    if (error.name === 'CredentialsProviderError') {
      console.log('    Configure AWS credentials using one of these methods:');
      console.log('    • aws configure');
      console.log('    • Set environment variables:');
      console.log('      export AWS_ACCESS_KEY_ID="your-key"');
      console.log('      export AWS_SECRET_ACCESS_KEY="your-secret"');
      console.log('    • Use IAM roles (recommended for EC2/ECS)');
    } else if (error.message?.includes('security token') || error.message?.includes('invalid')) {
      console.log('    Your credentials are expired or invalid:');
      console.log('    • Test current credentials: aws sts get-caller-identity');
      console.log('    • Reconfigure: aws configure');
      if (process.env.AWS_SESSION_TOKEN) {
        console.log('    • Your session token may be expired - refresh credentials');
      }
    } else if (error.message?.includes('region')) {
      console.log(`    Check region configuration: ${region}`);
      console.log('    • Set AWS_REGION environment variable');
      console.log('    • Configure default region: aws configure set region us-east-1');
    } else {
      console.log('    General troubleshooting:');
      console.log('    • Check configuration: aws configure list');
      console.log('    • Test credentials: aws sts get-caller-identity');
      console.log('    • Verify permissions for your user/role');
    }
    
    return { success: false, error };
  }
}

// Function to test AWS service permissions
async function testServicePermissions(region) {
  logSubsection('Service Permissions Test');
  
  const services = [
    {
      name: 'STS (Security Token Service)',
      description: 'Already tested above',
      test: null,
      required: true
    },
    {
      name: 'CodePipeline',
      description: 'Required for pipeline operations',
      test: async () => {
        const client = new CodePipelineClient({ region });
        await client.send(new ListPipelinesCommand({ maxResults: 1 }));
      },
      required: true
    },
    {
      name: 'CloudWatch Logs',
      description: 'Required for log monitoring',
      test: async () => {
        const client = new CloudWatchLogsClient({ region });
        await client.send(new DescribeLogGroupsCommand({ limit: 1 }));
      },
      required: true
    },
    {
      name: 'S3',
      description: 'Required for artifact storage',
      test: async () => {
        const client = new S3Client({ region });
        await client.send(new ListBucketsCommand({}));
      },
      required: true
    }
  ];
  
  const results = [];
  
  for (const service of services) {
    if (!service.test) {
      console.log(`  ${colorize('✓', 'green')} ${service.name}: ${service.description}`);
      results.push({ name: service.name, success: true });
      continue;
    }
    
    try {
      await service.test();
      console.log(`  ${colorize('✓', 'green')} ${service.name}: ${colorize('OK', 'green')} - ${service.description}`);
      results.push({ name: service.name, success: true });
    } catch (error) {
      const status = service.required ? colorize('REQUIRED', 'red') : colorize('OPTIONAL', 'yellow');
      console.log(`  ${colorize('✗', 'red')} ${service.name}: ${colorize('FAILED', 'red')} (${status}) - ${service.description}`);
      console.log(`    Error: ${error.message}`);
      
      if (error.name === 'AccessDeniedException') {
        console.log(`    ${colorize('Solution', 'yellow')}: Add ${service.name} permissions to your AWS user/role`);
      } else if (error.name === 'UnauthorizedOperation') {
        console.log(`    ${colorize('Solution', 'yellow')}: Your user/role needs ${service.name} permissions`);
      }
      
      results.push({ name: service.name, success: false, error: error.message, required: service.required });
    }
  }
  
  const failedRequired = results.filter(r => !r.success && r.required);
  const failedOptional = results.filter(r => !r.success && !r.required);
  
  if (failedRequired.length > 0) {
    log(`\n❌ ${failedRequired.length} required service(s) failed permission test`, 'red');
    return false;
  } else if (failedOptional.length > 0) {
    log(`\n⚠️  ${failedOptional.length} optional service(s) failed permission test`, 'yellow');
    return true;
  } else {
    log('\n✅ All service permissions validated successfully!', 'green');
    return true;
  }
}

// Function to show summary and recommendations
function showSummary(credentialResult, permissionResult, region) {
  logSubsection('Summary & Recommendations');
  
  if (credentialResult.success && permissionResult) {
    log('🎉 AWS credentials are properly configured!', 'green');
    console.log('\n  You can now:');
    console.log('  • Run E2E tests: npm run test:e2e:complete');
    console.log('  • Deploy infrastructure: npm run deploy');
    console.log('  • Use AWS services in your application');
    
    if (credentialResult.identity?.Arn.includes(':user/')) {
      console.log('\n  💡 Security tip: Consider using IAM roles instead of long-term user credentials');
    }
  } else {
    log('❌ AWS credentials need attention', 'red');
    console.log('\n  Next steps:');
    
    if (!credentialResult.success) {
      console.log('  1. Fix credential configuration (see solutions above)');
      console.log('  2. Test with: aws sts get-caller-identity');
    }
    
    if (!permissionResult) {
      console.log('  3. Add required AWS permissions to your user/role');
      console.log('  4. Contact your AWS administrator if needed');
    }
    
    console.log('  5. Re-run this script to verify fixes');
  }
  
  console.log(`\n  ${colorize('Region used', 'cyan')}: ${region}`);
  console.log(`  ${colorize('Script location', 'cyan')}: scripts/validate-aws-credentials.js`);
}

// Main function
async function main() {
  const args = process.argv.slice(2);
  const region = args[0] || process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || 'us-east-1';
  
  console.log(colorize('🔐 AWS Credentials Validation Tool', 'bright'));
  console.log(colorize(`   Region: ${region}`, 'cyan'));
  console.log(colorize(`   Time: ${new Date().toISOString()}`, 'cyan'));
  
  try {
    // Step 1: Show configuration
    logSection('AWS Configuration Analysis');
    showAWSConfiguration();
    
    // Step 2: Validate credentials
    logSection('Credential Validation');
    const credentialResult = await validateCredentials(region);
    
    // Step 3: Test service permissions (only if credentials are valid)
    let permissionResult = false;
    if (credentialResult.success) {
      logSection('Service Permissions Test');
      permissionResult = await testServicePermissions(region);
    }
    
    // Step 4: Show summary
    logSection('Summary');
    showSummary(credentialResult, permissionResult, region);
    
    // Exit with appropriate code
    if (credentialResult.success && permissionResult) {
      process.exit(0);
    } else {
      process.exit(1);
    }
    
  } catch (error) {
    log(`\n❌ Unexpected error: ${error.message}`, 'red');
    console.error(error.stack);
    process.exit(1);
  }
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
  process.exit(1);
});

// Run the script
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
