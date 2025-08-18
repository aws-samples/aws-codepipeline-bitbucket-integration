#!/bin/bash

set -e

ENVIRONMENT="staging"
AWS_REGION=""

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    --region)
      AWS_REGION="$2"
      shift 2
      ;;
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --help)
      echo "Usage: $0 [--region <aws-region>] [--environment <env>]"
      echo "  --region: AWS Region (required if not configured)"
      echo "  --environment: Environment (default: staging)"
      echo ""
      echo "Examples:"
      echo "  $0 --region us-west-2"
      echo "  $0 --region us-east-1 --environment staging"
      echo "  $0  # Detects region automatically"
      exit 0
      ;;
    *)
      echo "❌ Unknown argument: $1"
      echo "Use --help to see available options"
      exit 1
      ;;
  esac
done

# Function to detect and confirm region
detect_and_confirm_region() {
    if [ -n "$AWS_REGION" ]; then
        echo "🌍 Region specified via parameter: $AWS_REGION"
    else
        # Try to detect region from AWS CLI
        DETECTED_REGION=$(aws configure get region 2>/dev/null || echo "")
        
        if [ -n "$DETECTED_REGION" ]; then
            echo "🌍 AWS region detected: $DETECTED_REGION"
            echo -n "Use this region for cleanup? (y/N): "
            read -r response
            if [[ "$response" =~ ^[yY]$ ]]; then
                AWS_REGION="$DETECTED_REGION"
            else
                echo -n "Enter the desired AWS region: "
                read -r AWS_REGION
            fi
        else
            echo "⚠️  No AWS region configuration detected"
            echo -n "Enter AWS region for cleanup: "
            read -r AWS_REGION
        fi
    fi
    
    # Validate region
    if [ -z "$AWS_REGION" ]; then
        echo "❌ AWS region is required"
        echo "Use: $0 --region <aws-region> or configure AWS CLI"
        exit 1
    fi
    
    # Test if region is valid and accessible
    echo "🔍 Validating region $AWS_REGION..."
    if ! aws ec2 describe-regions --region "$AWS_REGION" --query 'Regions[?RegionName==`'$AWS_REGION'`]' --output text >/dev/null 2>&1; then
        echo "❌ Invalid or inaccessible region: $AWS_REGION"
        echo "Please verify that:"
        echo "  - The region exists (e.g., us-east-1, us-west-2, eu-west-1)"
        echo "  - Your AWS credentials are configured"
        echo "  - You have permissions to access the region"
        exit 1
    fi
    
    echo "✅ Region confirmed: $AWS_REGION"
}

# Function to confirm action
confirm_action() {
    echo -n "$1 (y/N): "
    read -r response
    case "$response" in
        [yY][eE][sS]|[yY]) 
            return 0
            ;;
        *)
            return 1
            ;;
    esac
}

echo "🧹 E2E Test Resources Cleanup"
echo "============================="

# Detect and confirm AWS region
detect_and_confirm_region

echo ""
echo "🎯 Configuration:"
echo "  - AWS Region: $AWS_REGION"
echo "  - Environment: $ENVIRONMENT"
echo ""

# Discover and remove test pipeline stacks
echo "🔍 Discovering test pipeline stacks..."

# Find all stacks that follow the Pipeline-Proj*-Repo* pattern
PIPELINE_STACKS=$(aws cloudformation list-stacks \
  --region $AWS_REGION \
  --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE UPDATE_ROLLBACK_COMPLETE \
  --query 'StackSummaries[?starts_with(StackName, `Pipeline-Proj`) && contains(StackName, `Repo`)].StackName' \
  --output text 2>/dev/null || echo "")

if [ -n "$PIPELINE_STACKS" ] && [ "$PIPELINE_STACKS" != "None" ]; then
    echo "📋 Pipeline stacks found:"
    for stack in $PIPELINE_STACKS; do
        echo "  - $stack"
    done
    echo ""
    
    if confirm_action "Remove all found pipeline stacks?"; then
        echo "🗑️  Removing pipeline stacks..."
        SCRIPT_DIR="$(dirname "$0")"
        ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
        
        # Get sources bucket for context
        SOURCES_BUCKET=$(aws cloudformation describe-stacks \
          --region $AWS_REGION \
          --stack-name BitbucketIntegrationV2Stack-staging \
          --query 'Stacks[0].Outputs[?OutputKey==`SourcesBucketName`].OutputValue' \
          --output text 2>/dev/null || echo "default-bucket")
        
        # Get artifacts bucket for context
        ARTIFACTS_BUCKET=$(aws cloudformation describe-stacks \
          --region $AWS_REGION \
          --stack-name BitbucketIntegrationV2Stack-staging \
          --query 'Stacks[0].Outputs[?OutputKey==`ArtifactsBucketName`].OutputValue' \
          --output text 2>/dev/null || echo "default-artifacts-bucket")
        
        cd "$ROOT_DIR/infra/pipeline-factory"
        
        # Install dependencies if necessary
        if [ ! -d "node_modules" ]; then
            echo "📦 Installing dependencies..."
            npm install
        fi
        
        # Build TypeScript
        echo "🔨 Compiling TypeScript..."
        npm run build 2>/dev/null || true
        
        for stack in $PIPELINE_STACKS; do
            echo "🗑️  Removing stack: $stack"
            
            # Try to destroy the stack using CDK
            # We need to extract repository info from stack name if possible
            # Format: Pipeline-Proj{project}-Repo{repo}
            REPO_KEY_PART=$(echo "$stack" | sed 's/Pipeline-Proj//' | sed 's/-Repo/-\//')
            
            # Use direct CloudFormation deletion (more reliable for cleanup)
            echo "🗑️  Deleting stack via CloudFormation..."
            if aws cloudformation delete-stack \
              --region $AWS_REGION \
              --stack-name "$stack"; then
                
                # Wait for deletion to complete
                echo "⏳ Waiting for completion of $stack removal..."
                if aws cloudformation wait stack-delete-complete \
                  --region $AWS_REGION \
                  --stack-name "$stack"; then
                    echo "✅ Stack $stack deleted successfully"
                else
                    echo "❌ Timeout or error deleting stack $stack"
                    echo "ℹ️  Check AWS Console for detailed error information"
                fi
            else
                echo "❌ Failed to initiate deletion of stack $stack"
                echo "ℹ️  Stack may have dependencies or protection enabled"
            fi
            
            # Verify stack is actually gone
            if aws cloudformation describe-stacks --region $AWS_REGION --stack-name "$stack" >/dev/null 2>&1; then
                echo "⚠️  Stack $stack still exists - deletion failed"
                echo "ℹ️  Manual cleanup may be required via AWS Console"
            else
                echo "✅ Confirmed: Stack $stack has been removed"
            fi
        done
        
        cd "$ROOT_DIR"
        echo "✅ All pipeline stacks processed"
    fi
else
    echo "ℹ️  No pipeline stacks found with pattern Pipeline-Proj*-Repo*"
fi

# Additional cleanup of orphaned resources
echo ""
echo "🧹 Cleaning up orphaned resources..."

# Clean up orphaned CodeBuild projects that follow the Proj*-Repo*-Build pattern
echo "🔍 Looking for test CodeBuild projects..."
CODEBUILD_PROJECTS=$(aws codebuild list-projects \
  --region $AWS_REGION \
  --query 'projects[?starts_with(@, `Proj`) && contains(@, `Repo`) && ends_with(@, `Build`)]' \
  --output text 2>/dev/null || echo "")

if [ -n "$CODEBUILD_PROJECTS" ] && [ "$CODEBUILD_PROJECTS" != "None" ]; then
    echo "📋 CodeBuild projects found:"
    for project in $CODEBUILD_PROJECTS; do
        echo "  - $project"
    done
    
    if confirm_action "Remove orphaned CodeBuild projects?"; then
        for project in $CODEBUILD_PROJECTS; do
            echo "🗑️  Removing CodeBuild project: $project"
            aws codebuild delete-project \
              --region $AWS_REGION \
              --name "$project" 2>/dev/null || echo "⚠️  Error removing $project"
        done
        echo "✅ CodeBuild projects processed"
    fi
else
    echo "ℹ️  No orphaned CodeBuild projects found"
fi

# Clean up orphaned secrets from Secrets Manager
echo "🔍 Looking for test webhook secrets..."
WEBHOOK_SECRETS=$(aws secretsmanager list-secrets \
  --region $AWS_REGION \
  --query 'SecretList[?contains(Name, `bitbucket-integration-v2`) && contains(Name, `webhook-secret`)].Name' \
  --output text 2>/dev/null || echo "")

if [ -n "$WEBHOOK_SECRETS" ] && [ "$WEBHOOK_SECRETS" != "None" ]; then
    echo "📋 Webhook secrets found:"
    for secret in $WEBHOOK_SECRETS; do
        echo "  - $secret"
    done
    
    if confirm_action "Remove orphaned webhook secrets?"; then
        for secret in $WEBHOOK_SECRETS; do
            echo "🗑️  Removing secret: $secret"
            aws secretsmanager delete-secret \
              --region $AWS_REGION \
              --secret-id "$secret" \
              --force-delete-without-recovery 2>/dev/null || echo "⚠️  Error removing $secret"
        done
        echo "✅ Webhook secrets processed"
    fi
else
    echo "ℹ️  No orphaned webhook secrets found"
fi

# Clean up DynamoDB data
DYNAMODB_TABLE=$(aws cloudformation describe-stacks \
  --region $AWS_REGION \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`RepositoryMappingTableName`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -n "$DYNAMODB_TABLE" ]; then
    if confirm_action "Remove test mappings from DynamoDB?"; then
        echo "🗑️  Removing test mappings..."
        aws dynamodb delete-item \
          --region $AWS_REGION \
          --table-name $DYNAMODB_TABLE \
          --key '{"repositoryKey": {"S": "E2ETEST/e2e-test-repo"}}' 2>/dev/null || true
        echo "✅ Mappings removed"
    fi
fi

# Clean up test S3 files
SOURCES_BUCKET=$(aws cloudformation describe-stacks \
  --region $AWS_REGION \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`SourcesBucketName`].OutputValue' \
  --output text 2>/dev/null || echo "")

if [ -n "$SOURCES_BUCKET" ]; then
    if confirm_action "Remove test files from S3?"; then
        echo "🗑️  Removing test files from S3..."
        aws s3 rm "s3://$SOURCES_BUCKET/repositories/e2etest/" --recursive --region $AWS_REGION 2>/dev/null || true
        echo "✅ S3 files removed"
    fi
fi

# Remove Bitbucket project/repository (optional)
if confirm_action "Remove test project from Bitbucket Server?"; then
    echo "⚠️  Manual removal required:"
    echo "  1. Access Bitbucket Server"
    echo "  2. Navigate to E2ETEST project"
    echo "  3. Remove e2e-test-repo repository"
    echo "  4. Remove E2ETEST project if no other repositories exist"
fi

echo ""
echo "✅ E2E cleanup completed!"
echo ""
echo "📋 Resources maintained (if they exist):"
echo "  - BitbucketServerEcsStack-staging"
echo "  - BitbucketIntegrationV2Stack-staging"
echo ""
echo "To completely remove staging environment:"
echo "  ./scripts/cleanup-resources.sh --environment staging"
