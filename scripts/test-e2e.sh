#!/bin/bash

set -e

# Function to detect and confirm AWS region
detect_and_confirm_region() {
    local region=""
    
    # Check if region is already set via environment variable
    if [ -n "${AWS_DEFAULT_REGION}" ]; then
        region="${AWS_DEFAULT_REGION}"
        echo "🌍 Region from AWS_DEFAULT_REGION: $region"
    else
        # Try to detect region from AWS CLI configuration
        region=$(aws configure get region 2>/dev/null || echo "")
        
        if [ -n "$region" ]; then
            echo "🌍 AWS region detected: $region"
            echo -n "Use this region for E2E tests? (y/N): "
            read -r response
            if [[ ! "$response" =~ ^[yY]$ ]]; then
                echo -n "Enter the desired AWS region: "
                read -r region
            fi
        else
            echo "⚠️  No AWS region configuration detected"
            echo -n "Enter AWS region for E2E tests: "
            read -r region
        fi
    fi
    
    # Validate region
    if [ -z "$region" ]; then
        echo "❌ AWS region is required"
        echo "Set AWS_DEFAULT_REGION environment variable or configure AWS CLI"
        exit 1
    fi
    
    # Test if region is valid and accessible
    echo "🔍 Validating region $region..."
    if ! aws ec2 describe-regions --region "$region" --query 'Regions[?RegionName==`'$region'`]' --output text >/dev/null 2>&1; then
        echo "❌ Invalid or inaccessible region: $region"
        exit 1
    fi
    
    echo "✅ Region confirmed: $region"
    export AWS_TEST_REGION="$region"
}

echo "🚀 Running End-to-End tests in staging environment"
echo "======================================================"

# Detect and confirm AWS region
detect_and_confirm_region

# Configure environment
export TEST_ENVIRONMENT=staging

# Variables for cleanup
TEST_PROJECT="E2ETEST"
TEST_REPO="e2e-test-repo"
CLEANUP_NEEDED=false

# Cleanup function
cleanup() {
    if [ "$CLEANUP_NEEDED" = true ]; then
        echo "🧹 Cleaning up test resources..."
        
        # Remove test S3 files
        if [ -n "$SOURCES_BUCKET" ]; then
            echo "  - Removing test S3 files..."
            aws s3 rm "s3://$SOURCES_BUCKET/repositories/e2etest/" --recursive --region "${AWS_TEST_REGION}" 2>/dev/null || true
        fi
        
        # Clean up test SQS messages (if necessary)
        echo "  - Cleaning up SQS messages..."
        # SQS cleans up automatically after processing
        
        echo "✅ Cleanup completed"
    fi
}

# Configure trap for cleanup in case of error or exit
trap cleanup EXIT

# Check if resources exist
echo "🔍 Checking staging resources..."

INTEGRATION_STACK=$(aws cloudformation describe-stacks \
  --region ${AWS_TEST_REGION} \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$INTEGRATION_STACK" = "NOT_FOUND" ]; then
    echo "❌ BitbucketIntegrationV2Stack-staging stack not found"
    echo "Execute: ./scripts/deploy-bitbucket-integration-v2.sh --environment staging"
    exit 1
fi

# Get webhook endpoint
WEBHOOK_ENDPOINT=$(aws cloudformation describe-stacks \
  --region ${AWS_TEST_REGION} \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookEndpoint`].OutputValue' \
  --output text)

echo "🔗 Webhook Endpoint: $WEBHOOK_ENDPOINT"

# Get other necessary resources
SOURCES_BUCKET=$(aws cloudformation describe-stacks \
  --region ${AWS_TEST_REGION} \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`SourcesBucketName`].OutputValue' \
  --output text)

echo "📦 Sources Bucket: $SOURCES_BUCKET"

# Check if Bitbucket Server is running
BITBUCKET_STACK=$(aws cloudformation describe-stacks \
  --region ${AWS_TEST_REGION} \
  --stack-name BitbucketServerEcsStack-staging \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$BITBUCKET_STACK" = "NOT_FOUND" ]; then
    echo "⚠️  Bitbucket Server ECS not found - tests will use simulation"
    BITBUCKET_URL=""
else
    BITBUCKET_URL=$(aws cloudformation describe-stacks \
      --region ${AWS_TEST_REGION} \
      --stack-name BitbucketServerEcsStack-staging \
      --query 'Stacks[0].Outputs[?contains(OutputKey, `ALB`)].OutputValue' \
      --output text)
    echo "🌐 Bitbucket URL: http://$BITBUCKET_URL"
fi

# Setup: Configure test project and repository (if Bitbucket available)
if [ -n "$BITBUCKET_URL" ] && [ "$BITBUCKET_URL" != "None" ]; then
    echo "🔧 Configuring test project and repository in Bitbucket..."
    
    # Check if configuration script exists
    if [ -f "./scripts/configure-bitbucket-server.sh" ]; then
        echo "  - Running Bitbucket Server configuration..."
        ./scripts/configure-bitbucket-server.sh --project $TEST_PROJECT --repo $TEST_REPO --environment staging || {
            echo "⚠️  Bitbucket configuration failed, continuing with simulation"
        }
        CLEANUP_NEEDED=true
    else
        echo "  - Configuration script not found, using simulation"
    fi
else
    echo "⚠️  Bitbucket Server not available, using full simulation"
fi

# Execute E2E tests
echo "🧪 Running End-to-End tests..."
NODE_ENV=staging \
TEST_ENVIRONMENT=staging \
WEBHOOK_ENDPOINT=$WEBHOOK_ENDPOINT \
AWS_TEST_REGION=${AWS_TEST_REGION} \
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
npm run test:integration:e2e

echo "✅ End-to-End tests completed!"
echo ""
echo "📊 E2E test summary:"
echo "  - Webhook Endpoint: $WEBHOOK_ENDPOINT"
echo "  - Sources Bucket: $SOURCES_BUCKET"
echo "  - Bitbucket URL: ${BITBUCKET_URL:-'Simulated'}"
echo "  - Test Project: $TEST_PROJECT"
echo "  - Test Repository: $TEST_REPO"
echo "  - Cleanup: ${CLEANUP_NEEDED}"
