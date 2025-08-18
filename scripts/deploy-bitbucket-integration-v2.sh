#!/bin/bash

# Deploy Bitbucket Integration V2 with CodePipeline
# This script deploys the complete integration solution

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
REGION=""
PROFILE=${AWS_PROFILE:-default}
ENVIRONMENT=""
BITBUCKET_EXISTING=false
BITBUCKET_URL=""
BITBUCKET_TYPE=""

# Function to select Bitbucket installation type
select_bitbucket_installation_type() {
    echo -e "${BLUE}🔄 Bitbucket Configuration${NC}"
    echo "=========================="
    echo "Select Bitbucket installation type:"
    echo "  1. Use existing Bitbucket Server/Enterprise installation"
    echo "  2. Use/create Bitbucket ECS installation (default flow)"
    echo ""
    
    read -p "Select an option (1-2) [default: 2]: " choice
    case $choice in
        1) BITBUCKET_EXISTING=true;;
        2|""|"") BITBUCKET_EXISTING=false;; # Default to ECS flow
        *) echo "Invalid selection. Using default: ECS installation"; BITBUCKET_EXISTING=false;;
    esac
    
    echo -e "${GREEN}✅ Selected: $([ "$BITBUCKET_EXISTING" = true ] && echo "Existing installation" || echo "ECS installation")${NC}"
    echo ""
}

# Function to collect information about existing Bitbucket installation
collect_existing_bitbucket_info() {
    echo -e "${BLUE}📋 Existing Bitbucket Installation Information${NC}"
    echo "============================================="
    
    read -p "Bitbucket URL (e.g., http://bitbucket.example.com): " BITBUCKET_URL
    if [ -z "$BITBUCKET_URL" ]; then
        print_error "Bitbucket URL is required"
        collect_existing_bitbucket_info
        return
    fi
    
    # Remove trailing slash if it exists
    BITBUCKET_URL=${BITBUCKET_URL%/}
    
    # Extract hostname for later use
    BITBUCKET_ALB=$(echo "$BITBUCKET_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||')
    
    print_status "Bitbucket URL configured: $BITBUCKET_URL"
    echo ""
}

# Function to select environment
select_environment() {
    echo -e "${BLUE}🌍 Environment Selection${NC}"
    echo "========================"
    echo "Available environments:"
    echo "  1. dev     - Development environment"
    echo "  2. staging - Staging environment (default)"
    echo "  3. prod    - Production environment"
    echo ""
    
    read -p "Select environment (1-3) [default: 2]: " choice
    case $choice in
        1) ENVIRONMENT="dev";;
        3) ENVIRONMENT="prod";;
        2|""|"") ENVIRONMENT="staging";; # Default to staging
        *) echo "Invalid selection. Using default: staging"; ENVIRONMENT="staging";;
    esac
    
    echo -e "${GREEN}✅ Selected environment: ${ENVIRONMENT}${NC}"
    echo ""
}

# Function to select region
select_region() {
    echo -e "${BLUE}🌍 AWS Region Selection${NC}"
    echo "======================"
    echo "Available regions:"
    echo "  1. us-east-1      - N. Virginia"
    echo "  2. us-east-2      - Ohio (recommended)"
    echo "  3. us-west-1      - N. California"
    echo "  4. us-west-2      - Oregon"
    echo "  5. eu-west-1      - Ireland"
    echo "  6. ap-southeast-1 - Singapore"
    echo "  7. custom         - Enter custom region"
    echo ""
    
    read -p "Select region (1-7) [default: 2]: " choice
    case $choice in
        1) REGION="us-east-1";;
        3) REGION="us-west-1";;
        4) REGION="us-west-2";;
        5) REGION="eu-west-1";;
        6) REGION="ap-southeast-1";;
        7) 
            read -p "Enter custom region: " custom_region
            if [ -n "$custom_region" ]; then
                REGION="$custom_region"
            else
                echo "Invalid region. Using default: us-east-2"
                REGION="us-east-2"
            fi
            ;;
        2|""|"") REGION="us-east-2";; # Default to us-east-2
        *) echo "Invalid selection. Using default: us-east-2"; REGION="us-east-2";;
    esac
    
    echo -e "${GREEN}✅ Selected region: ${REGION}${NC}"
    echo ""
}

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --environment|-e)
            ENVIRONMENT="$2"
            shift 2
            ;;
        --region|-r)
            REGION="$2"
            shift 2
            ;;
        --profile|-p)
            PROFILE="$2"
            shift 2
            ;;
        --bitbucket-type)
            BITBUCKET_TYPE="$2"
            shift 2
            ;;
        --bitbucket-url)
            BITBUCKET_URL="$2"
            shift 2
            ;;
        --test-credentials)
            TEST_CREDENTIALS=true
            shift
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --environment, -e    Environment (dev/staging/prod)"
            echo "  --region, -r         AWS region (interactive selection if not provided)"
            echo "  --profile, -p        AWS profile [default: default]"
            echo "  --bitbucket-type     Bitbucket installation type (existing/ecs)"
            echo "  --bitbucket-url      Bitbucket URL (required when type=existing)"
            echo "  --test-credentials   Only test AWS credentials and exit"
            echo "  --help, -h           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Select environment if not provided
if [ -z "$ENVIRONMENT" ]; then
    select_environment
fi

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Select region if not provided
if [ -z "$REGION" ]; then
    select_region
fi

# Function to determine the final region with strict priority (no fallbacks)
determine_region() {
    local selected_region=""
    
    # Priority 1: CLI parameter (highest priority)
    if [ -n "$REGION" ]; then
        selected_region="$REGION"
        print_info "Using region from CLI parameter: $selected_region"
        return 0
    fi
    
    # Priority 2: AWS_DEFAULT_REGION environment variable
    if [ -n "$AWS_DEFAULT_REGION" ]; then
        selected_region="$AWS_DEFAULT_REGION"
        print_info "Using region from AWS_DEFAULT_REGION: $selected_region"
        REGION="$selected_region"
        return 0
    fi
    
    # Priority 3: CDK_DEFAULT_REGION environment variable
    if [ -n "$CDK_DEFAULT_REGION" ]; then
        selected_region="$CDK_DEFAULT_REGION"
        print_info "Using region from CDK_DEFAULT_REGION: $selected_region"
        REGION="$selected_region"
        return 0
    fi
    
    # Priority 4: AWS profile default region
    local profile_region=$(aws configure get region 2>/dev/null)
    if [ -n "$profile_region" ]; then
        selected_region="$profile_region"
        print_info "Using region from AWS profile: $selected_region"
        REGION="$selected_region"
        return 0
    fi
    
    # No fallback - force interactive selection or error
    print_error "No region specified via CLI parameter or environment variables"
    print_error "Please specify region using --region parameter or set AWS_DEFAULT_REGION/CDK_DEFAULT_REGION"
    exit 1
}

# Enhanced region validation and setup
setup_region() {
    print_info "🌍 Region Configuration"
    print_info "======================"
    
    # Show current environment state
    print_info "Environment variables:"
    print_info "  AWS_DEFAULT_REGION: ${AWS_DEFAULT_REGION:-'not set'}"
    print_info "  CDK_DEFAULT_REGION: ${CDK_DEFAULT_REGION:-'not set'}"
    print_info "  AWS Profile region: $(aws configure get region 2>/dev/null || echo 'not set')"
    
    # If no region specified via CLI, determine region using priority
    if [ -z "$REGION" ]; then
        determine_region
    fi
    
    print_info "✅ Final selected region: $REGION"
    
    # CRITICAL: Set environment variables to match selected region
    # This ensures CDK uses the correct region
    export AWS_DEFAULT_REGION="$REGION"
    export CDK_DEFAULT_REGION="$REGION"
    
    print_info "✅ Environment variables updated to match selected region"
}

# Validate region is set
setup_region
if [ -z "$REGION" ]; then
    print_error "Region must be specified via --region parameter, environment variables, or interactive selection"
    exit 1
fi

# Function to print status
print_status() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

# Function to validate AWS credentials
validate_aws_credentials() {
  print_info "Checking AWS credentials..."
  
  if ! aws sts get-caller-identity &>/dev/null; then
    print_error "AWS credentials validation failed"
    echo ""
    echo "📝 Error details:"
    echo "  - No valid AWS credentials found in the environment"
    echo "  - Or the configured credentials don't have sufficient permissions"
    echo ""
    echo "🔍 To fix this issue:"
    echo "  - Make sure you have configured AWS credentials (aws configure)"
    echo "  - Verify that your credentials have not expired"
    echo "  - Check that you have the necessary permissions for CloudFormation, Lambda, etc."
    echo "  - You may need to run 'aws sso login' if using SSO"
    echo ""
    echo "🔄 Once your credentials are properly configured, try running this script again."
    exit 1
  fi
  
  print_status "AWS credentials validated successfully"
  echo ""
}

# Validate environment
if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
    print_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
    exit 1
fi

# Validate bitbucket-type parameter if provided
if [ -n "$BITBUCKET_TYPE" ]; then
    if [[ ! "$BITBUCKET_TYPE" =~ ^(existing|ecs)$ ]]; then
        print_error "Invalid bitbucket-type: $BITBUCKET_TYPE. Must be 'existing' or 'ecs'."
        exit 1
    fi
    
    # Set BITBUCKET_EXISTING based on parameter
    if [ "$BITBUCKET_TYPE" = "existing" ]; then
        BITBUCKET_EXISTING=true
        # Validate that bitbucket-url is provided for existing installations
        if [ -z "$BITBUCKET_URL" ]; then
            print_error "When using --bitbucket-type existing, --bitbucket-url is required."
            exit 1
        fi
        # Remove trailing slash if it exists
        BITBUCKET_URL=${BITBUCKET_URL%/}
        print_info "Using existing Bitbucket installation: $BITBUCKET_URL"
    else
        BITBUCKET_EXISTING=false
        print_info "Using Bitbucket ECS installation (will auto-discover URL)"
    fi
fi

# Validate AWS credentials before proceeding
validate_aws_credentials

# If only testing credentials, exit here
if [ "$TEST_CREDENTIALS" = true ]; then
    echo -e "${GREEN}✅ AWS credentials are valid. Exiting as requested.${NC}"
    exit 0
fi

# Ask user about Bitbucket installation only if not provided via parameters
if [ -z "$BITBUCKET_TYPE" ]; then
    select_bitbucket_installation_type
fi

STACK_NAME="BitbucketIntegrationV2Stack-${ENVIRONMENT}"

echo -e "${BLUE}🚀 Bitbucket Integration V2 Deployment Script${NC}"
echo -e "${BLUE}=============================================${NC}"
echo -e "${BLUE}Environment: ${ENVIRONMENT}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo -e "${BLUE}Profile: ${PROFILE}${NC}"
echo ""

# Check prerequisites
echo -e "${BLUE}📋 Checking Prerequisites${NC}"
echo "================================"

# Check AWS CLI
if ! command -v aws &> /dev/null; then
    print_error "AWS CLI not found. Please install AWS CLI."
    exit 1
fi
print_status "AWS CLI found"

# Check CDK
if ! command -v cdk &> /dev/null; then
    print_error "AWS CDK not found. Please install AWS CDK."
    exit 1
fi
print_status "AWS CDK found"

# Check Node.js
if ! command -v node &> /dev/null; then
    print_error "Node.js not found. Please install Node.js."
    exit 1
fi
print_status "Node.js found ($(node --version))"

# Process based on installation type choice
if [ "$BITBUCKET_EXISTING" = true ]; then
    # Only collect info interactively if URL wasn't provided via parameter
    if [ -z "$BITBUCKET_URL" ]; then
        collect_existing_bitbucket_info
    else
        # Extract hostname for later use
        BITBUCKET_ALB=$(echo "$BITBUCKET_URL" | sed -e 's|^[^/]*//||' -e 's|/.*$||')
        print_status "Bitbucket URL configured: $BITBUCKET_URL"
    fi
else
    # Check if Bitbucket Server ECS export exists
    print_info "Checking Bitbucket Server ECS export..."
    BITBUCKET_ALB=$(aws cloudformation list-exports \
        --region $REGION \
        --profile $PROFILE \
        --query "Exports[?Name==\`BitbucketServerECS-${ENVIRONMENT}-ALB-DNS\`].Value" \
        --output text 2>/dev/null || echo "")

    if [ -n "$BITBUCKET_ALB" ]; then
        print_status "Bitbucket Server ECS found: http://$BITBUCKET_ALB"
    else
        print_warning "Bitbucket Server ECS export not found. Checking for stack..."
        
        # Try to find stack with environment suffix
        ECS_STACK_NAME=$(aws cloudformation list-stacks \
            --region $REGION \
            --profile $PROFILE \
            --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
            --query "StackSummaries[?StackName==\`BitbucketServerEcsStack-${ENVIRONMENT}\`].StackName" \
            --output text 2>/dev/null | head -1)
        
        if [ -n "$ECS_STACK_NAME" ]; then
            print_info "Found Bitbucket ECS stack: $ECS_STACK_NAME"
            
            # Try to get ALB DNS from stack outputs
            BITBUCKET_ALB=$(aws cloudformation describe-stacks \
                --stack-name "$ECS_STACK_NAME" \
                --region $REGION \
                --profile $PROFILE \
                --query 'Stacks[0].Outputs[?contains(OutputKey, `ALB`) && contains(OutputKey, `DNS`)].OutputValue' \
                --output text 2>/dev/null || echo "")
            
            if [ -n "$BITBUCKET_ALB" ]; then
                print_status "Found ALB DNS from stack: http://$BITBUCKET_ALB"
            else
                print_warning "Could not get ALB DNS from stack outputs."
            fi
        else
            print_warning "No Bitbucket ECS stack found for environment: $ENVIRONMENT"
            echo ""
            echo "To deploy Bitbucket Server ECS first, run:"
            echo "  ./scripts/deploy-bitbucket-server-ecs.sh --environment $ENVIRONMENT"
            echo ""
            read -p "Continue anyway? (y/N): " -n 1 -r
            echo
            if [[ ! $REPLY =~ ^[Yy]$ ]]; then
                exit 1
            fi
        fi
    fi
fi

echo ""

# Navigate to integration directory
print_info "Navigating to integration directory..."
# Get the script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
# Navigate to project root directory (1 level up from script directory)
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"
cd "$PROJECT_ROOT/infra/bitbucket-integration-v2"

# Install dependencies
print_info "Installing dependencies for CDK infrastructure..."
npm install
print_status "CDK dependencies installed"

# Install dependencies for shared layer
print_info "Installing dependencies for shared layer..."
cd "$PROJECT_ROOT/app/bitbucket-integration-v2/shared-layer/nodejs"
npm install
print_status "Shared layer dependencies installed"

# Install dependencies for repository processor
print_info "Installing dependencies for repository processor..."
cd "$PROJECT_ROOT/app/bitbucket-integration-v2/repository-processor"
npm install
print_status "Repository processor dependencies installed"

# Install dependencies for webhook handler
print_info "Installing dependencies for webhook handler..."
cd "$PROJECT_ROOT/app/bitbucket-integration-v2/webhook-handler"
npm install
print_status "Webhook handler dependencies installed"

# Return to CDK directory
cd "$PROJECT_ROOT/infra/bitbucket-integration-v2"

# Build the project
print_info "Building project..."
npm run build 2>/dev/null || print_warning "Build step skipped (no TypeScript)"
print_status "Project built"

# Bootstrap CDK if needed
print_info "Checking CDK bootstrap..."
if ! aws cloudformation describe-stacks --stack-name CDKToolkit --region $REGION --profile $PROFILE &> /dev/null; then
    print_info "Bootstrapping CDK..."
    npx cdk bootstrap --profile $PROFILE --region $REGION
    print_status "CDK bootstrapped"
else
    print_status "CDK already bootstrapped"
fi

# Deploy the stack
echo ""
echo -e "${BLUE}🚀 Deploying Bitbucket Integration V2${NC}"
echo "====================================="

# Add Bitbucket context parameters for CDK
BITBUCKET_CONTEXT=""
if [ "$BITBUCKET_EXISTING" = true ]; then
    BITBUCKET_CONTEXT="--context bitbucketServerUrl=$BITBUCKET_URL"
elif [ -n "$BITBUCKET_ALB" ]; then
    BITBUCKET_CONTEXT="--context bitbucketServerUrl=http://$BITBUCKET_ALB"
else
    print_error "No Bitbucket Server URL available. Cannot deploy integration."
    exit 1
fi

# Clear CDK context cache to ensure fresh region resolution
print_info "Clearing CDK context cache to ensure fresh region resolution..."
rm -rf cdk.out/
rm -f cdk.context.json

# Debug region information
print_info "Region consistency check:"
print_info "  Script REGION: $REGION"
print_info "  AWS_DEFAULT_REGION: $AWS_DEFAULT_REGION"
print_info "  CDK_DEFAULT_REGION: $CDK_DEFAULT_REGION"

print_info "Starting deployment..."
npx cdk deploy $STACK_NAME \
    --require-approval never \
    --profile $PROFILE \
    --region $REGION \
    --context deployEnv=$ENVIRONMENT \
    $BITBUCKET_CONTEXT \
    --outputs-file cdk-outputs.json \
    --no-previous-parameters \
    --force \
    --verbose

if [ $? -eq 0 ]; then
    print_status "Deployment completed successfully!"
else
    print_error "Deployment failed!"
    exit 1
fi

# Extract outputs
if [ -f cdk-outputs.json ]; then
    print_info "Extracting deployment outputs..."
    
    WEBHOOK_ENDPOINT=$(cat cdk-outputs.json | jq -r ".\"$STACK_NAME\".WebhookEndpoint // empty")
    TOKEN_SECRET=$(cat cdk-outputs.json | jq -r ".\"$STACK_NAME\".BitbucketTokenSecretName // empty")
    WEBHOOK_SECRET=$(cat cdk-outputs.json | jq -r ".\"$STACK_NAME\".BitbucketWebhookSecretName // empty")
    PIPELINE_NAME=$(cat cdk-outputs.json | jq -r ".\"$STACK_NAME\".PipelineName // empty")
    
    echo ""
    echo -e "${GREEN}🎉 Deployment Summary${NC}"
    echo "===================="
    echo ""
    
    if [ -n "$WEBHOOK_ENDPOINT" ]; then
        echo -e "${BLUE}Webhook Endpoint:${NC} $WEBHOOK_ENDPOINT"
    fi
    
    if [ -n "$PIPELINE_NAME" ]; then
        echo -e "${BLUE}CodePipeline:${NC} $PIPELINE_NAME"
    fi
    
    if [ -n "$TOKEN_SECRET" ]; then
        echo -e "${BLUE}Token Secret:${NC} $TOKEN_SECRET"
    fi
    
    if [ -n "$WEBHOOK_SECRET" ]; then
        echo -e "${BLUE}Webhook Secret:${NC} $WEBHOOK_SECRET"
    fi
    
    echo ""
    echo -e "${YELLOW}📝 Next Steps:${NC}"
    echo "=============="
    echo ""
    echo "1. 🔑 Configure Bitbucket Token:"
    echo "   aws secretsmanager update-secret \\"
    echo "     --secret-id $TOKEN_SECRET \\"
    echo "     --secret-string '{\"token\":\"YOUR_BITBUCKET_TOKEN\",\"username\":\"admin\"}'"
    echo ""
    echo "2. 📦 Use the repository setup script for each repository:"
    echo "   ./scripts/setup-repository.sh PROJECT/REPOSITORY"
    echo ""
    echo "   Example: ./scripts/setup-repository.sh TEST/my-app"
    echo ""
    echo "   The script will automatically:"
    echo "   - Configure webhook secrets per repository"
    echo "   - Create Bitbucket repositories and webhooks"
    echo "   - Create CodePipeline for each repository"
    echo "   - Register repository-pipeline mappings"
    echo ""
    echo -e "${GREEN}✅ Integration deployed successfully!${NC}"
    
else
    print_warning "Could not find deployment outputs file"
fi

# Create setup instructions
cat > SETUP_INSTRUCTIONS.md << EOF
# Bitbucket Integration V2 Setup Instructions

## 🎉 Deployment Completed!

Your Bitbucket Integration V2 has been successfully deployed.

## 📋 Configuration Steps

### 1. Configure Bitbucket Personal Access Token

Create a personal access token in Bitbucket Server:
1. Go to Bitbucket Server: $([ "$BITBUCKET_EXISTING" = true ] && echo "$BITBUCKET_URL" || echo "http://$BITBUCKET_ALB")
2. Profile → Manage Account → Personal Access Tokens
3. Create token with permissions: REPO_READ, REPO_WRITE, PROJECT_READ
4. Update the secret:

\`\`\`bash
aws secretsmanager update-secret \\
  --secret-id $TOKEN_SECRET \\
  --secret-string '{"token":"YOUR_BITBUCKET_TOKEN","username":"admin"}'
\`\`\`

### 2. Setup Repositories Using Automated Script

Use the repository setup script for each repository you want to integrate:

\`\`\`bash
# Setup complete integration for a repository
./scripts/setup-repository.sh PROJECT/REPOSITORY

# Examples:
./scripts/setup-repository.sh TEST/my-app
./scripts/setup-repository.sh PROD/api-service
\`\`\`

**The script automatically:**
- Configures global Bitbucket credentials (first run only)
- Creates Bitbucket project and repository
- Generates unique webhook secret per repository
- Creates CodePipeline for the repository
- Configures webhook in Bitbucket
- Registers repository-pipeline mapping in DynamoDB
- Tests the integration

**Script Options:**
\`\`\`bash
# Only create repository without pipeline
./scripts/setup-repository.sh PROJECT/REPO --repo-only

# Only create pipeline for existing repository
./scripts/setup-repository.sh PROJECT/REPO --pipeline-only

# Only configure webhook for existing repository
./scripts/setup-repository.sh PROJECT/REPO --webhook-only
\`\`\`

## 🔍 Monitoring

- **CloudWatch Dashboard**: BitbucketIntegration-V2-Enhanced
- **Lambda Logs**: /aws/lambda/bitbucket-webhook-handler-v2, /aws/lambda/bitbucket-repository-processor-v2
- **CodePipeline**: $PIPELINE_NAME

## 🛠️ Troubleshooting

If webhooks are not working:
1. Check Lambda logs for errors
2. Verify secrets are configured correctly
3. Test webhook endpoint manually
4. Check Bitbucket Server connectivity

## 📞 Support

For issues, check the logs and documentation in the repository.
EOF

print_status "Setup instructions created: SETUP_INSTRUCTIONS.md"

echo ""
echo -e "${GREEN}🎉 Bitbucket Integration V2 deployment completed successfully!${NC}"
echo ""
