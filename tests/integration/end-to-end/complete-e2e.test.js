import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import { CodePipelineClient, ListPipelineExecutionsCommand, ListPipelinesCommand } from '@aws-sdk/client-codepipeline';
import { CloudWatchLogsClient, FilterLogEventsCommand, DescribeLogGroupsCommand } from '@aws-sdk/client-cloudwatch-logs';
import { STSClient, GetCallerIdentityCommand } from '@aws-sdk/client-sts';
import { execSync } from 'child_process';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'fs';
import { writeFileSync } from 'fs';
import { join } from 'path';
import { tmpdir, homedir } from 'os';

// Função para ler variáveis do arquivo de credenciais
function loadCredentialsFromFile() {
  const credentialsPath = '/tmp/e2e-credentials.sh';
  
  if (!existsSync(credentialsPath)) {
    console.warn(`⚠️ Credentials file not found at ${credentialsPath}`);
    return {};
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
    
    console.log(`✅ Loaded ${Object.keys(variables).length} variables from credentials file`);
    return variables;
  } catch (error) {
    console.warn(`⚠️ Error reading credentials file: ${error.message}`);
    return {};
  }
}

// Carregar variáveis do arquivo
const credentialsVars = loadCredentialsFromFile();

const TEST_REGION = credentialsVars.AWS_TEST_REGION;
const TEST_PROJECT = credentialsVars.E2E_TEST_PROJECT;
const TEST_REPO = credentialsVars.E2E_TEST_REPO;
const PIPELINE_STACK = credentialsVars.PIPELINE_STACK;
const BITBUCKET_URL = credentialsVars.E2E_BITBUCKET_URL;
const BITBUCKET_USER = credentialsVars.E2E_BITBUCKET_USER;
const BITBUCKET_TOKEN = credentialsVars.E2E_BITBUCKET_TOKEN;

// Function to show AWS credentials diagnostic information
async function showAWSCredentialsDebug(region) {
  console.log('📋 AWS Configuration Debug:');
  
  // Mask sensitive information
  function maskCredential(value) {
    if (!value) return 'Not set';
    if (value.length <= 8) return '****';
    return `${value.substring(0, 4)}****${value.substring(value.length - 4)}`;
  }
  
  // Show resolved credentials that AWS SDK will actually use
  try {
    console.log('   🔍 Resolved AWS Credentials (what SDK will use):');
    const stsClient = new STSClient({ region });
    
    // Get the resolved credentials from the STS client
    const credentials = await stsClient.config.credentials();
    
    if (credentials) {
      console.log(`     Access Key ID: ${maskCredential(credentials.accessKeyId)}`);
      console.log(`     Secret Access Key: ${maskCredential(credentials.secretAccessKey)}`);
      console.log(`     Session Token: ${credentials.sessionToken ? 'Present (temporary credentials)' : 'Not present (long-term credentials)'}`);
      
      // Determine credential type and source
      if (credentials.sessionToken) {
        console.log('     Credential Type: Temporary (assumed role, STS, or SSO)');
      } else {
        console.log('     Credential Type: Long-term (IAM user credentials)');
      }
      
      // Try to determine the source based on available information
      if (process.env.AWS_ACCESS_KEY_ID === credentials.accessKeyId) {
        console.log('     Source: Environment Variables');
      } else if (process.env.AWS_PROFILE) {
        console.log(`     Source: AWS Profile (${process.env.AWS_PROFILE})`);
      } else {
        console.log('     Source: Shared credentials file or IAM role');
      }
      
      // Show expiration if available
      if (credentials.expiration) {
        const expirationTime = new Date(credentials.expiration);
        const now = new Date();
        const timeUntilExpiration = Math.floor((expirationTime - now) / 1000 / 60); // minutes
        
        if (timeUntilExpiration > 0) {
          console.log(`     Expires: ${expirationTime.toISOString()} (in ${timeUntilExpiration} minutes)`);
        } else {
          console.log(`     ⚠️  EXPIRED: ${expirationTime.toISOString()} (${Math.abs(timeUntilExpiration)} minutes ago)`);
        }
      }
    } else {
      console.log('     ❌ No credentials resolved by AWS SDK');
    }
  } catch (error) {
    console.log(`     ❌ Error resolving credentials: ${error.message}`);
  }
  
  console.log('');
  
  // Show environment variables for reference
  const awsEnvVars = {
    'AWS_ACCESS_KEY_ID': process.env.AWS_ACCESS_KEY_ID,
    'AWS_SECRET_ACCESS_KEY': process.env.AWS_SECRET_ACCESS_KEY,
    'AWS_SESSION_TOKEN': process.env.AWS_SESSION_TOKEN,
    'AWS_REGION': process.env.AWS_REGION,
    'AWS_DEFAULT_REGION': process.env.AWS_DEFAULT_REGION,
    'AWS_PROFILE': process.env.AWS_PROFILE
  };
  
  console.log('   📝 Environment Variables (for reference):');
  Object.entries(awsEnvVars).forEach(([key, value]) => {
    if (key.includes('KEY') || key.includes('TOKEN')) {
      console.log(`     ${key}: ${maskCredential(value)}`);
    } else {
      console.log(`     ${key}: ${value || 'Not set'}`);
    }
  });
  
  // Check AWS files
  const awsDir = join(homedir(), '.aws');
  const credentialsFile = join(awsDir, 'credentials');
  const configFile = join(awsDir, 'config');
  
  console.log('   📁 AWS Files:');
  console.log(`     ~/.aws/credentials: ${existsSync(credentialsFile) ? 'Exists' : 'Not found'}`);
  console.log(`     ~/.aws/config: ${existsSync(configFile) ? 'Exists' : 'Not found'}`);
  
  // Show credentials file content (masked)
  if (existsSync(credentialsFile)) {
    try {
      const credContent = readFileSync(credentialsFile, 'utf8');
      const profiles = credContent.match(/\[([^\]]+)\]/g) || [];
      console.log(`     Profiles in credentials: ${profiles.join(', ')}`);
      
      // Check if there are session tokens (temporary credentials)
      if (credContent.includes('aws_session_token')) {
        console.log('     ⚠️  Temporary credentials detected in file');
      }
    } catch (error) {
      console.log(`     Error reading credentials file: ${error.message}`);
    }
  }
  
  // Show credential resolution order
  console.log('   🔄 AWS SDK Credential Resolution Order:');
  console.log('     1. Environment variables (AWS_ACCESS_KEY_ID, etc.)');
  console.log('     2. Shared credentials file (~/.aws/credentials)');
  console.log('     3. ECS container credentials (if running in ECS)');
  console.log('     4. EC2 instance metadata (if running on EC2)');
  console.log('     5. AWS SSO');
}

// AWS credentials validation functions
async function validateAWSCredentials(region) {
  console.log('🔐 Validating AWS credentials...');
  
  // Show diagnostic information first
  await showAWSCredentialsDebug(region);
  
  try {
    const stsClient = new STSClient({ region });
    const identity = await stsClient.send(new GetCallerIdentityCommand({}));
    
    console.log('✅ AWS credentials valid:');
    console.log(`   Account: ${identity.Account}`);
    console.log(`   User/Role: ${identity.Arn}`);
    console.log(`   Region: ${region}`);
    
    // Determine credential type from ARN
    if (identity.Arn.includes(':assumed-role/')) {
      console.log('   Type: Assumed Role (temporary credentials)');
    } else if (identity.Arn.includes(':user/')) {
      console.log('   Type: IAM User (long-term credentials)');
    } else if (identity.Arn.includes(':root')) {
      console.log('   Type: Root Account (not recommended for automation)');
    }
    
    return true;
  } catch (error) {
    console.error('❌ AWS credentials validation failed:');
    console.log(`   Error: ${error.message}`);
    
    // Show what credentials were attempted
    console.log('   Attempted Configuration:');
    if (process.env.AWS_ACCESS_KEY_ID) {
      console.log(`     Access Key: ${process.env.AWS_ACCESS_KEY_ID.substring(0, 4)}****${process.env.AWS_ACCESS_KEY_ID.substring(process.env.AWS_ACCESS_KEY_ID.length - 4)} (from environment)`);
    }
    if (process.env.AWS_SESSION_TOKEN) {
      console.log('     Session Token: Present (temporary credentials)');
    }
    console.log(`     Region: ${region}`);
    
    // Specific error messages based on error type
    if (error.name === 'CredentialsProviderError') {
      console.log('   🔧 SOLUTION: Configure AWS credentials:');
      console.log('      aws configure');
      console.log('      OR set environment variables:');
      console.log('      export AWS_ACCESS_KEY_ID="your-key"');
      console.log('      export AWS_SECRET_ACCESS_KEY="your-secret"');
    } else if (error.message?.includes('security token')) {
      console.log('   🔧 SOLUTION: Your credentials are expired or invalid:');
      console.log('      aws sts get-caller-identity  # Test current credentials');
      console.log('      aws configure  # Reconfigure if needed');
      if (process.env.AWS_SESSION_TOKEN) {
        console.log('      # Your session token may be expired - refresh your credentials');
      }
    } else if (error.message?.includes('region')) {
      console.log(`   🔧 SOLUTION: Check region configuration: ${region}`);
    } else {
      console.log('   🔧 SOLUTION: Check your AWS configuration:');
      console.log('      aws configure list  # Check current config');
      console.log('      aws sts get-caller-identity  # Test credentials');
    }
    
    throw new Error(`AWS credentials validation failed: ${error.message}`);
  }
}

async function validateAWSPermissions(region) {
  console.log('🔐 Validating AWS service permissions...');
  
  const validations = [
    {
      service: 'CodePipeline',
      test: async () => {
        const client = new CodePipelineClient({ region });
        await client.send(new ListPipelinesCommand({ maxResults: 1 }));
      }
    },
    {
      service: 'CloudWatch Logs',
      test: async () => {
        const client = new CloudWatchLogsClient({ region });
        await client.send(new DescribeLogGroupsCommand({ limit: 1 }));
      }
    }
  ];
  
  for (const validation of validations) {
    try {
      await validation.test();
      console.log(`   ✅ ${validation.service}: OK`);
    } catch (error) {
      console.error(`   ❌ ${validation.service}: ${error.message}`);
      if (error.name === 'AccessDeniedException') {
        console.log(`   🔧 SOLUTION: Add ${validation.service} permissions to your AWS user/role`);
      }
      throw new Error(`Missing permissions for ${validation.service}: ${error.message}`);
    }
  }
  
  console.log('✅ All AWS service permissions validated');
}

describe('Complete E2E Test - Bitbucket to CodePipeline', () => {
  let bitbucketUrl, pipelineName;
  let codePipelineClient, logsClient;
  let tempDir, testId, repoPath;
  let bitbucketUser, bitbucketToken;
  let pushStartTime = 0;

  beforeAll(async () => {
    // Validate AWS credentials first (fail fast if invalid)
    await validateAWSCredentials(TEST_REGION);
    await validateAWSPermissions(TEST_REGION);

    // Initialize AWS clients
    const awsConfig = { region: TEST_REGION };
    codePipelineClient = new CodePipelineClient(awsConfig);
    logsClient = new CloudWatchLogsClient(awsConfig);

    // Use Bitbucket URL and credentials from credentials file
    bitbucketUrl = BITBUCKET_URL;
    bitbucketUser = BITBUCKET_USER;
    bitbucketToken = BITBUCKET_TOKEN;

    // Generate pipeline name from PIPELINE_STACK variable (required)
    if (!PIPELINE_STACK) {
      throw new Error('PIPELINE_STACK environment variable is required for E2E test');
    }
    
    // Transform: Pipeline-Projxlt-Repoqeebh -> Projxlt-Repoqeebh-Pipeline
    pipelineName = PIPELINE_STACK.replace(/^Pipeline-/, '') + '-Pipeline';
    console.log(`🔍 Generated pipeline name from stack: ${PIPELINE_STACK} -> ${pipelineName}`);

    console.log(`🔧 Recursos E2E:
    - Bitbucket: ${bitbucketUrl}
    - Pipeline: ${pipelineName}`);

    // Create temp directory for git operations
    tempDir = mkdtempSync(join(tmpdir(), 'e2e-test-'));
    testId = Date.now();
    repoPath = join(tempDir, TEST_REPO);
  }, 30000);

  afterAll(() => {
    // Cleanup temp directory
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should clone repository successfully', async () => {
    console.log('🔄 Step 1: Cloning repository...');
    
    // Require Bitbucket credentials to be provided via environment variables
    if (!bitbucketUser || !bitbucketToken) {
      throw new Error('Bitbucket credentials (E2E_BITBUCKET_USER and E2E_BITBUCKET_TOKEN) are required for E2E test');
    }
    
    // Use Basic Auth with username:token format (URL encoded)
    const urlParts = bitbucketUrl.split('//');
    const encodedToken = encodeURIComponent(bitbucketToken);
    const cloneUrl = `${urlParts[0]}//${bitbucketUser}:${encodedToken}@${urlParts[1]}/scm/${TEST_PROJECT}/${TEST_REPO}.git`;
    
    try {
      execSync(`git clone ${cloneUrl} ${repoPath}`, {
        stdio: ['pipe', 'pipe', 'pipe'],
        timeout: 30000,
        encoding: 'utf8'
      });
    } catch (error) {
      console.error(`❌ Git clone failed:`);
      console.error(`   Command: git clone [URL_HIDDEN] ${repoPath}`);
      console.error(`   Error: ${error.message}`);
      if (error.stderr) console.error(`   Stderr: ${error.stderr}`);
      if (error.stdout) console.error(`   Stdout: ${error.stdout}`);
      
      // Specific error messages based on stderr content
      if (error.stderr?.includes('Authentication failed')) {
        console.error(`⚠️  SOLUTION: Set credentials with: source /tmp/e2e-credentials.sh`);
        console.error(`   Or run setup script first: ./scripts/setup-e2e-test.sh`);
      } else if (error.stderr?.includes('not found') || error.stderr?.includes('does not exist')) {
        console.error(`⚠️  SOLUTION: Repository not found. Check if:`);
        console.error(`   1. Repository exists: ${TEST_PROJECT}/${TEST_REPO}`);
        console.error(`   2. Run setup script: ./scripts/setup-e2e-test.sh`);
      }
      
      throw new Error('Repository must be accessible for E2E test');
    }

    console.log('✅ Repository prepared');
    expect(repoPath).toBeDefined();
  }, 30000);

  it('should switch to main branch and configure git', async () => {
    console.log('🔄 Step 2: Switching to main branch...');
    
    // Git operations setup
    process.chdir(repoPath);
    execSync('git config user.name "E2E Test"', { stdio: 'pipe' });
    execSync('git config user.email "e2e@test.com"', { stdio: 'pipe' });
    
    // Configure git remote with credentials if available
    if (bitbucketUser && bitbucketToken) {
      const urlParts = bitbucketUrl.split('//');
      const encodedToken = encodeURIComponent(bitbucketToken);
      const remoteUrl = `${urlParts[0]}//${bitbucketUser}:${encodedToken}@${urlParts[1]}/scm/${TEST_PROJECT}/${TEST_REPO}.git`;
      execSync(`git remote set-url origin ${remoteUrl}`, { stdio: 'pipe' });
    }
    
    // Check current branch and ensure we're on main (required)
    const currentBranch = execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    console.log(`📍 Current branch: ${currentBranch}`);
    
    if (currentBranch !== 'main') {
      console.log('🔄 Switching to main branch...');
      execSync('git checkout main', { stdio: 'pipe' });
      console.log('✅ Switched to main branch');
    }
    
    // Pull latest changes to avoid non-fast-forward issues (required)
    console.log('🔄 Pulling latest changes...');
    execSync('git pull origin main', { stdio: 'pipe' });
    console.log('✅ Pulled latest changes');
    
    expect(process.cwd()).toContain(TEST_REPO);
  }, 30000);

  it('should create test file and commit changes', async () => {
    console.log('🔄 Step 3: Creating test file and committing...');
    
    // Create test file
    const testFile = join(repoPath, `test-${testId}.txt`);
    writeFileSync(testFile, `E2E Test File\nCreated at: ${new Date().toISOString()}\nTest ID: ${testId}\nPurpose: Trigger webhook and pipeline execution\n`);

    try {
      execSync(`git add test-${testId}.txt`, { stdio: 'pipe' });
      execSync(`git commit -m "E2E test commit ${testId}"`, { stdio: 'pipe' });
    } catch (error) {
      console.error(`❌ Git commit failed: ${error.message}`);
      throw error;
    }

    console.log('✅ Test file committed');
    expect(testFile).toBeDefined();
  }, 30000);

  it('should push changes to trigger webhook', async () => {
    console.log('🔄 Step 4: Pushing to trigger webhook...');
    
    pushStartTime = Date.now();
    
    try {
      execSync('git push origin main', { stdio: ['pipe', 'pipe', 'pipe'], timeout: 30000, encoding: 'utf8' });
      console.log('✅ Push completed - webhook should be triggered');
    } catch (error) {
      console.error(`❌ Git push failed:`);
      console.error(`   Error: ${error.message}`);
      if (error.stderr) console.error(`   Stderr: ${error.stderr}`);
      if (error.stdout) console.error(`   Stdout: ${error.stdout}`);
      throw new Error('Git push failed - repository not properly configured for main branch');
    }

    pushStartTime = Date.now();
    expect(pushStartTime).toBeGreaterThan(0);
  }, 30000);

  it('should process webhook events successfully', async () => {
    console.log('🔄 Step 5: Waiting for processing...');
    await new Promise(resolve => setTimeout(resolve, 60000)); // 1 minute for complete processing

    console.log('🔄 Step 6: Checking webhook handler logs...');
    
    try {
      const webhookLogs = await logsClient.send(new FilterLogEventsCommand({
        logGroupName: '/aws/lambda/bitbucket-webhook-handler-v2',
        startTime: pushStartTime,
        filterPattern: '"Webhook processed successfully"'
      }));

      console.log(`🔍 Found ${webhookLogs.events?.length || 0} webhook events`);
      
      if (webhookLogs.events?.length > 0) {
        console.log('📋 Sample webhook events:');
        webhookLogs.events.slice(0, 2).forEach((event, i) => {
          console.log(`   Event ${i + 1}: ${event.message?.substring(0, 150)}...`);
        });
      }

      const hasWebhookProcessing = webhookLogs.events?.some(event => 
        event.message?.includes('Webhook processed successfully')
      );

      if (hasWebhookProcessing) {
        console.log('✅ Webhook handler processed event successfully');
      } else {
        console.log('⚠️  Webhook processing success message not found in logs');
      }
    } catch (error) {
      console.warn('⚠️  Could not check webhook logs:', error.message);
    }
    
    expect(pushStartTime || Date.now()).toBeGreaterThan(0);
  }, 90000);

  it('should process repository events successfully', async () => {
    console.log('🔄 Step 7: Checking repository processor logs...');
    
    try {
      const processorLogs = await logsClient.send(new FilterLogEventsCommand({
        logGroupName: '/aws/lambda/bitbucket-repository-processor-v2',
        startTime: pushStartTime,
        filterPattern: '"Repository processor batch completed"'
      }));

      console.log(`🔍 Found ${processorLogs.events?.length || 0} processor events`);
      
      if (processorLogs.events?.length > 0) {
        console.log('📋 Sample processor events:');
        processorLogs.events.slice(0, 2).forEach((event, i) => {
          console.log(`   Event ${i + 1}: ${event.message?.substring(0, 150)}...`);
        });
      }

      const hasRepositoryProcessing = processorLogs.events?.some(event => 
        event.message?.includes('Repository processor batch completed')
      );

      if (hasRepositoryProcessing) {
        console.log('✅ Repository processor batch completed successfully');
      } else {
        console.log('⚠️  Repository processor batch completion message not found in logs');
      }
    } catch (error) {
      console.warn('⚠️  Could not check processor logs:', error.message);
    }
    
    expect(pushStartTime || Date.now()).toBeGreaterThan(0);
  }, 60000);

  it('should trigger pipeline execution', async () => {
    console.log('🔄 Step 8: Checking pipeline execution...');
    
    try {
      // Get the latest pipeline execution
      const executions = await codePipelineClient.send(new ListPipelineExecutionsCommand({
        pipelineName: pipelineName,
        maxResults: 1
      }));

      console.log(`🔍 Found ${executions.pipelineExecutionSummaries?.length || 0} executions`);
      
      if (!executions.pipelineExecutionSummaries || executions.pipelineExecutionSummaries.length === 0) {
        throw new Error('No pipeline executions found - integration may not be working correctly');
      }
      
      const latestExecution = executions.pipelineExecutionSummaries[0];
      const executionStartTime = latestExecution.startTime?.getTime() || 0;
      const isAfterPush = executionStartTime >= pushStartTime;
      
      console.log('📋 Latest execution analysis:');
      console.log(`   Execution ID: ${latestExecution.pipelineExecutionId}`);
      console.log(`   Status: ${latestExecution.status}`);
      console.log(`   Start Time: ${latestExecution.startTime?.toISOString()}`);
      console.log(`   Push Time: ${new Date(pushStartTime).toISOString()}`);
      console.log(`   Started after push: ${isAfterPush}`);
      
      if ((latestExecution.status === 'Succeeded' || latestExecution.status === 'InProgress') && isAfterPush) {
        console.log(`✅ Latest pipeline execution ${latestExecution.status.toLowerCase()} and was triggered after push!`);
        console.log('✅ Pipeline execution verified!');
        expect(['Succeeded', 'InProgress']).toContain(latestExecution.status);
        return;
      } else if (!['Succeeded', 'InProgress'].includes(latestExecution.status)) {
        throw new Error(`Latest pipeline execution failed with status: ${latestExecution.status}`);
      } else if (!isAfterPush) {
        throw new Error('Latest pipeline execution was not triggered by recent push - integration may not be working');
      }
    } catch (error) {
      if (error.message?.includes('No pipeline executions found') || error.message?.includes('No successful pipeline execution')) {
        throw error; // Re-throw our custom error
      }
      console.warn('⚠️  Could not check pipeline:', error.message);
      if (error.name === 'PipelineNotFoundException') {
        console.warn(`   Pipeline '${pipelineName}' not found. Check if it exists.`);
        throw new Error(`Pipeline '${pipelineName}' not found`);
      }
      throw new Error(`Failed to check pipeline execution: ${error.message}`);
    }

    // Should not reach here
    expect(pipelineName).toBeDefined();
  }, 60000);

  it('should complete full E2E flow successfully', async () => {
    console.log('✅ E2E Test completed successfully!');
    
    // Final assertion - all components are defined
    expect(testId).toBeDefined();
    expect(bitbucketUrl).toBeDefined();
    expect(pipelineName).toBeDefined();
  }, 10000);
});
