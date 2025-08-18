#!/bin/bash

# Bitbucket Integration V2 - Unified Repository Setup Script
set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
NC='\033[0m'

# Global variables
REPOSITORY_KEY=""
PROJECT_KEY=""
REPO_NAME=""
BRANCH="master"
ENVIRONMENT=""
AWS_REGION=""
BITBUCKET_URL=""
WEBHOOK_ENDPOINT=""
ADMIN_USER=""
ADMIN_PASS=""

# Options
FULL_SETUP=true
REPO_ONLY=false
PIPELINE_ONLY=false
WEBHOOK_ONLY=false
FORCE_GLOBAL_SETUP=false
SKIP_GLOBAL_CHECK=false
GLOBAL_ONLY=false

# Logging functions
log_info() { echo -e "${BLUE}[INFO]${NC} $1"; }
log_success() { echo -e "${GREEN}[SUCCESS]${NC} $1"; }
log_warning() { echo -e "${YELLOW}[WARNING]${NC} $1"; }
log_error() { echo -e "${RED}[ERROR]${NC} $1"; }
log_step() { echo -e "${CYAN}[STEP]${NC} $1"; }

# Show usage
show_usage() {
    cat << EOF
Usage: $0 PROJECT/REPOSITORY [OPTIONS]

Setup Bitbucket repository with CodePipeline integration

ARGUMENTS:
    PROJECT/REPOSITORY    Repository in format PROJECT/REPO-NAME (e.g., TEST/my-app)

OPTIONS:
    --full               Complete setup: repo + pipeline + webhook (default)
    --repo-only          Only create Bitbucket repository
    --pipeline-only      Only create CodePipeline
    --webhook-only       Only configure webhook
    --global-only        Only perform global Bitbucket setup
    --force-global-setup Force global configuration even if exists
    --skip-global-check  Skip global configuration check
    --branch BRANCH      Target branch (default: master)
    --environment ENV    Environment (dev/staging/prod, default: dev)
    --help               Show this help message

EXAMPLES:
    $0 TEST/my-app                    # Full setup for TEST/my-app
    $0 PROD/api-service --pipeline-only  # Only create pipeline
    $0 --global-only                     # Only configure global settings
EOF
}

# Parse arguments
parse_arguments() {
    [ $# -eq 0 ] && { show_usage; exit 1; }
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --full) FULL_SETUP=true; REPO_ONLY=false; PIPELINE_ONLY=false; WEBHOOK_ONLY=false; shift ;;
            --repo-only) REPO_ONLY=true; FULL_SETUP=false; shift ;;
            --pipeline-only) PIPELINE_ONLY=true; FULL_SETUP=false; shift ;;
            --webhook-only) WEBHOOK_ONLY=true; FULL_SETUP=false; shift ;;
            --global-only) GLOBAL_ONLY=true; FULL_SETUP=false; shift ;;
            --force-global-setup) FORCE_GLOBAL_SETUP=true; shift ;;
            --skip-global-check) SKIP_GLOBAL_CHECK=true; shift ;;
            --branch) BRANCH="$2"; shift 2 ;;
            --environment) ENVIRONMENT="$2"; shift 2 ;;
            --help) show_usage; exit 0 ;;
            -*) log_error "Unknown option: $1"; show_usage; exit 1 ;;
            *) 
                if [ -z "$REPOSITORY_KEY" ]; then
                    REPOSITORY_KEY="$1"
                else
                    log_error "Multiple repository arguments provided"
                    exit 1
                fi
                shift ;;
        esac
    done
    
    # Validate repository format
    if [ "$GLOBAL_ONLY" = false ]; then
        [ -z "$REPOSITORY_KEY" ] && { log_error "Repository key required"; exit 1; }
        [[ ! "$REPOSITORY_KEY" =~ ^[A-Z0-9]+/[a-zA-Z0-9_-]+$ ]] && { log_error "Invalid format. Use: PROJECT/REPOSITORY"; exit 1; }
        
        PROJECT_KEY=$(echo "$REPOSITORY_KEY" | cut -d'/' -f1)
        REPO_NAME=$(echo "$REPOSITORY_KEY" | cut -d'/' -f2)
    fi
}

# Function to select environment
select_environment() {
    echo -e "${BLUE}🌍 Environment Selection${NC}"
    echo "========================"
    echo "Available environments:"
    echo "  1. dev     - Development environment"
    echo "  2. staging - Staging environment"
    echo "  3. prod    - Production environment"
    echo ""
    
    while true; do
        read -p "Select environment (1-3): " choice
        case $choice in
            1) ENVIRONMENT="dev"; break;;
            2) ENVIRONMENT="staging"; break;;
            3) ENVIRONMENT="prod"; break;;
            *) echo "Invalid selection. Please choose 1, 2, or 3.";;
        esac
    done
    
    log_success "Selected environment: ${ENVIRONMENT}"
    echo ""
}

# Setup environment
setup_environment() {
    log_step "🌍 Setting up environment..."
    
    # Select environment if not provided
    if [ -z "$ENVIRONMENT" ]; then
        select_environment
    fi
    
    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
        exit 1
    fi
    
    AWS_REGION=${AWS_DEFAULT_REGION:-$(aws configure get region 2>/dev/null || echo "us-east-1")}
    export AWS_REGION
    
    log_info "Environment: $ENVIRONMENT"
    log_info "AWS Region: $AWS_REGION"
    [ "$GLOBAL_ONLY" = false ] && log_info "Repository: $REPOSITORY_KEY, Branch: $BRANCH"
}

# Check global setup
check_global_setup() {
    [ "$SKIP_GLOBAL_CHECK" = true ] && { log_warning "Skipping global setup check"; return 1; }
    
    log_step "🔍 Checking global Bitbucket configuration..."
    
    local token_exists
    token_exists=$(aws secretsmanager describe-secret \
        --region "$AWS_REGION" \
        --secret-id bitbucket-integration-v2/${ENVIRONMENT}/token \
        --query 'Name' --output text 2>/dev/null || echo "")
    
    if [ -n "$token_exists" ] && [ "$FORCE_GLOBAL_SETUP" = false ]; then
        log_success "Global configuration already exists"
        return 0
    else
        log_info "Global configuration needed"
        return 1
    fi
}

# Get credentials
get_user_credentials() {
    log_step "🔐 Getting Bitbucket credentials..."
    
    echo -n "Bitbucket username: "
    read -r ADMIN_USER
    echo -n "Bitbucket password: "
    read -rs ADMIN_PASS
    echo ""
    
    [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ] && { log_error "Username and password required"; exit 1; }
    log_success "Credentials provided"
}

# Load deployment info
load_deployment_info() {
    log_step "📋 Loading deployment information..."
    
    # Get Bitbucket URL
    local bitbucket_alb_dns
    bitbucket_alb_dns=$(aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name BitbucketServerEcsStack-${ENVIRONMENT} \
        --query 'Stacks[0].Outputs[?contains(OutputKey, `ALB`) && contains(OutputKey, `DNS`)].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    [ -z "$bitbucket_alb_dns" ] && { 
        log_error "Could not retrieve Bitbucket URL. Deploy BitbucketServerEcsStack first"
        exit 1
    }
    BITBUCKET_URL="http://$bitbucket_alb_dns"
    
    # Get webhook endpoint
    WEBHOOK_ENDPOINT=$(aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name BitbucketIntegrationV2Stack-${ENVIRONMENT} \
        --query 'Stacks[0].Outputs[?OutputKey==`WebhookEndpoint`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    [ -z "$WEBHOOK_ENDPOINT" ] && {
        log_error "Could not retrieve webhook endpoint. Deploy BitbucketIntegrationV2Stack first"
        exit 1
    }
    
    log_success "Deployment information loaded"
    log_info "Bitbucket URL: $BITBUCKET_URL"
    log_info "Webhook Endpoint: $WEBHOOK_ENDPOINT"
}

# Wait for Bitbucket
wait_for_bitbucket_ready() {
    log_step "⏳ Waiting for Bitbucket Server..."
    
    local max_attempts=30
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        if curl -s -f "$BITBUCKET_URL/rest/api/1.0/application-properties" > /dev/null 2>&1; then
            log_success "Bitbucket Server is ready!"
            return 0
        fi
        
        log_info "Attempt $attempt/$max_attempts: Waiting for Bitbucket Server..."
        sleep 10
        ((attempt++))
    done
    
    log_error "Bitbucket Server not ready within expected time"
    exit 1
}

# Setup global token
setup_global_access_token() {
    log_step "🔑 Setting up global access token..."
    
    local response
    response=$(curl -s -u "$ADMIN_USER:$ADMIN_PASS" -X PUT \
        "$BITBUCKET_URL/rest/access-tokens/1.0/users/$ADMIN_USER" \
        -H "Content-Type: application/json" \
        -d '{
            "name": "bitbucket-integration-global-token",
            "permissions": ["PROJECT_READ", "PROJECT_WRITE", "REPO_READ", "REPO_WRITE", "PROJECT_ADMIN", "REPO_ADMIN"]
        }' 2>/dev/null)
    
    local token
    token=$(echo "$response" | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
    
    if [ -n "$token" ]; then
        aws secretsmanager create-secret \
            --region "$AWS_REGION" \
            --name bitbucket-integration-v2/${ENVIRONMENT}/token \
            --secret-string "{\"token\":\"$token\",\"username\":\"$ADMIN_USER\"}" \
            --description "Global Bitbucket access token for ${ENVIRONMENT}" 2>/dev/null || \
        aws secretsmanager update-secret \
            --region "$AWS_REGION" \
            --secret-id bitbucket-integration-v2/${ENVIRONMENT}/token \
            --secret-string "{\"token\":\"$token\",\"username\":\"$ADMIN_USER\"}" > /dev/null
        
        log_success "Global access token configured"
    else
        log_error "Failed to generate access token: $response"
        exit 1
    fi
}

# Global setup
setup_global_bitbucket_config() {
    log_step "🌐 Performing global Bitbucket setup..."
    get_user_credentials
    load_deployment_info
    wait_for_bitbucket_ready
    setup_global_access_token
    log_success "Global Bitbucket configuration completed!"
}

# Create project
create_bitbucket_project() {
    log_step "📁 Creating Bitbucket project: $PROJECT_KEY"
    
    [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ] && { log_error "Admin credentials not available"; exit 1; }
    
    local response
    response=$(curl -s -u "$ADMIN_USER:$ADMIN_PASS" -X POST \
        "$BITBUCKET_URL/rest/api/1.0/projects" \
        -H "Content-Type: application/json" \
        -d "{
            \"key\": \"$PROJECT_KEY\",
            \"name\": \"$PROJECT_KEY Project\",
            \"description\": \"Project for $PROJECT_KEY repositories\"
        }" 2>/dev/null)
    
    if echo "$response" | grep -q "\"key\":\"$PROJECT_KEY\""; then
        log_success "Project $PROJECT_KEY created successfully"
    elif echo "$response" | grep -q -E "(already in use|already exists)"; then
        log_info "Project $PROJECT_KEY already exists"
    else
        log_error "Failed to create project $PROJECT_KEY: $response"
        exit 1
    fi
}

# Create repository
create_bitbucket_repository() {
    log_step "📦 Creating Bitbucket repository: $REPOSITORY_KEY"
    
    [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ] && { log_error "Admin credentials not available"; exit 1; }
    
    local response
    response=$(curl -s -u "$ADMIN_USER:$ADMIN_PASS" -X POST \
        "$BITBUCKET_URL/rest/api/1.0/projects/$PROJECT_KEY/repos" \
        -H "Content-Type: application/json" \
        -d "{
            \"name\": \"$REPO_NAME\",
            \"scmId\": \"git\",
            \"forkable\": true
        }" 2>/dev/null)
    
    if echo "$response" | grep -q "\"name\":\"$REPO_NAME\""; then
        log_success "Repository $REPO_NAME created successfully"
    elif echo "$response" | grep -q -E "(already taken|already in use|already exists)"; then
        log_info "Repository $REPO_NAME already exists"
    else
        log_error "Failed to create repository $REPO_NAME: $response"
        exit 1
    fi
}

# Generate webhook secret
generate_repository_webhook_secret() {
    log_step "🔐 Generating webhook secret for $REPOSITORY_KEY" >&2
    
    local secret_name="bitbucket-integration-v2/${ENVIRONMENT}/webhook-secrets/$PROJECT_KEY-$REPO_NAME"
    
    # Check if exists
    local existing_secret
    existing_secret=$(aws secretsmanager get-secret-value \
        --region "$AWS_REGION" \
        --secret-id "$secret_name" \
        --query 'SecretString' --output text 2>/dev/null || echo "")
    
    if [ -n "$existing_secret" ]; then
        log_info "Webhook secret already exists, reusing it" >&2
        echo "$existing_secret" | jq -r '.secret'
        return 0
    fi
    
    # Generate new secret
    local webhook_secret
    webhook_secret=$(openssl rand -base64 32 | tr -d '/+=' | head -c 32)
    
    [ -z "$webhook_secret" ] && { log_error "Failed to generate webhook secret" >&2; exit 1; }
    
    # Store secret
    aws secretsmanager create-secret \
        --region "$AWS_REGION" \
        --name "$secret_name" \
        --secret-string "{\"secret\":\"$webhook_secret\"}" \
        --description "Webhook secret for $REPOSITORY_KEY" >/dev/null 2>&1 || \
    aws secretsmanager update-secret \
        --region "$AWS_REGION" \
        --secret-id "$secret_name" \
        --secret-string "{\"secret\":\"$webhook_secret\"}" >/dev/null 2>&1
    
    log_success "Webhook secret generated and stored" >&2
    echo "$webhook_secret"
}

# Configure webhook
configure_repository_webhook() {
    local webhook_secret="$1"
    log_step "🔗 Configuring webhook for $REPOSITORY_KEY"
    
    [ -z "$ADMIN_USER" ] || [ -z "$ADMIN_PASS" ] && { log_error "Admin credentials not available"; exit 1; }
    
    # Check existing webhooks
    local existing_webhooks
    existing_webhooks=$(curl -s -u "$ADMIN_USER:$ADMIN_PASS" \
        "$BITBUCKET_URL/rest/api/1.0/projects/$PROJECT_KEY/repos/$REPO_NAME/webhooks" \
        -H "Accept: application/json" 2>/dev/null)
    
    local json_payload
    json_payload=$(jq -n \
        --arg name "CodePipeline Integration" \
        --arg url "$WEBHOOK_ENDPOINT" \
        --arg secret "$webhook_secret" \
        '{
            "name": $name,
            "url": $url,
            "events": ["repo:refs_changed"],
            "configuration": {
                "secret": $secret
            }
        }')
    
    # Update or create webhook
    if echo "$existing_webhooks" | grep -q '"name":"CodePipeline Integration"'; then
        local webhook_id
        webhook_id=$(echo "$existing_webhooks" | jq -r '.values[] | select(.name == "CodePipeline Integration") | .id' | head -1)
        
        if [ -n "$webhook_id" ] && [ "$webhook_id" != "null" ]; then
            log_info "Updating existing webhook (ID: $webhook_id)"
            log_info "Webhook payload: $json_payload"
            
            local response
            response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -u "$ADMIN_USER:$ADMIN_PASS" -X PUT \
                "$BITBUCKET_URL/rest/api/1.0/projects/$PROJECT_KEY/repos/$REPO_NAME/webhooks/$webhook_id" \
                -H "Content-Type: application/json" \
                -d "$json_payload" 2>/dev/null)
            
            local http_status
            http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
            local response_body
            response_body=$(echo "$response" | sed '/HTTP_STATUS:/d')
            
            log_info "HTTP Status: $http_status"
            log_info "Response body: $response_body"
            
            if echo "$response_body" | grep -q '"name":"CodePipeline Integration"'; then
                log_success "Webhook updated for $REPOSITORY_KEY"
            else
                log_error "Failed to update webhook (HTTP $http_status): $response_body"
                exit 1
            fi
        fi
    else
        log_info "Creating new webhook"
        log_info "Webhook payload: $json_payload"
        
        local response
        response=$(curl -s -w "\nHTTP_STATUS:%{http_code}" -u "$ADMIN_USER:$ADMIN_PASS" -X POST \
            "$BITBUCKET_URL/rest/api/1.0/projects/$PROJECT_KEY/repos/$REPO_NAME/webhooks" \
            -H "Content-Type: application/json" \
            -d "$json_payload" 2>/dev/null)
        
        local http_status
        http_status=$(echo "$response" | grep "HTTP_STATUS:" | cut -d: -f2)
        local response_body
        response_body=$(echo "$response" | sed '/HTTP_STATUS:/d')
        
        log_info "HTTP Status: $http_status"
        log_info "Response body: $response_body"
        
        if echo "$response_body" | grep -q '"name":"CodePipeline Integration"'; then
            log_success "Webhook created for $REPOSITORY_KEY"
        else
            log_error "Failed to create webhook (HTTP $http_status): $response_body"
            exit 1
        fi
    fi
}

# Create pipeline
create_codepipeline() {
    log_step "🚀 Creating CodePipeline for $REPOSITORY_KEY"
    
    local pipeline_name="$(echo "$PROJECT_KEY-$REPO_NAME-pipeline" | tr '[:upper:]' '[:lower:]')"
    local s3_bucket
    s3_bucket=$(aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name BitbucketIntegrationV2Stack-${ENVIRONMENT} \
        --query 'Stacks[0].Outputs[?OutputKey==`SourcesBucketName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    [ -z "$s3_bucket" ] && { log_error "Could not retrieve S3 source bucket"; exit 1; }
    
    # Deploy using CDK
    local current_dir="$PWD"
    local script_dir="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
    local pipeline_factory_dir="$script_dir/../infra/pipeline-factory"
    
    [ ! -d "$pipeline_factory_dir" ] && { log_error "Pipeline factory directory not found"; exit 1; }
    
    cd "$pipeline_factory_dir"
    
    # Install dependencies if needed
    [ ! -d "node_modules" ] && { log_info "Installing dependencies..."; npm install; }
    
    log_info "Deploying pipeline: $pipeline_name"
    npx cdk deploy \
        --require-approval never \
        --context pipelineName="$pipeline_name" \
        --context repositoryKey="$REPOSITORY_KEY" \
        --context branch="$BRANCH" \
        --context sourceBucket="$s3_bucket"
    
    local exit_code=$?
    cd "$current_dir"
    
    if [ $exit_code -eq 0 ]; then
        log_success "Pipeline $pipeline_name created successfully"
    else
        log_error "Failed to create pipeline $pipeline_name"
        exit 1
    fi
}

# Register in DynamoDB
register_in_dynamodb() {
    log_step "📊 Registering repository mapping in DynamoDB"
    
    local pipeline_name="$(echo "$PROJECT_KEY-$REPO_NAME-pipeline" | tr '[:upper:]' '[:lower:]')"
    local repository_key="$PROJECT_KEY/$REPO_NAME/$BRANCH"
    
    # Get table name
    local table_name
    table_name=$(aws cloudformation describe-stacks \
        --region "$AWS_REGION" \
        --stack-name BitbucketIntegrationV2Stack-${ENVIRONMENT} \
        --query 'Stacks[0].Outputs[?OutputKey==`RepositoryMappingTableName`].OutputValue' \
        --output text 2>/dev/null || echo "")
    
    [ -z "$table_name" ] && { log_error "DynamoDB table not found in integration stack"; exit 1; }
    
    # Create item
    local item
    item=$(cat << EOF
{
    "repositoryKey": {"S": "$repository_key"},
    "pipelineName": {"S": "$pipeline_name"},
    "enabled": {"BOOL": true},
    "createdAt": {"S": "$(date -u +%Y-%m-%dT%H:%M:%SZ)"},
    "project": {"S": "$PROJECT_KEY"},
    "repository": {"S": "$REPO_NAME"},
    "branch": {"S": "$BRANCH"}
}
EOF
    )
    
    # Put item
    if aws dynamodb put-item \
        --region "$AWS_REGION" \
        --table-name "$table_name" \
        --item "$item" 2>/dev/null; then
        log_success "Repository mapping registered in DynamoDB"
        log_info "Repository: $repository_key → Pipeline: $pipeline_name"
    else
        log_warning "Failed to register in DynamoDB, continuing..."
    fi
}

# Test integration
test_integration() {
    log_step "🧪 Testing integration for $REPOSITORY_KEY"
    
    # Get credentials
    local creds
    creds=$(aws secretsmanager get-secret-value \
        --region "$AWS_REGION" \
        --secret-id bitbucket-integration-v2/${ENVIRONMENT}/token \
        --query 'SecretString' --output text)
    
    local token username
    token=$(echo "$creds" | jq -r '.token')
    username=$(echo "$creds" | jq -r '.username')
    
    # Setup test environment
    local temp_dir="/tmp/integration-test-$(date +%s)"
    mkdir -p "$temp_dir"
    cd "$temp_dir"
    
    log_info "Creating test commit..."
    
    local bitbucket_host project_key_lower
    bitbucket_host=$(echo "$BITBUCKET_URL" | sed 's|http://||' | sed 's|https://||')
    project_key_lower=$(echo "$PROJECT_KEY" | tr '[:upper:]' '[:lower:]')
    
    # URL encode token properly - for Bitbucket Server personal access tokens
    # Token goes in username field, password can be empty
    local encoded_token
    encoded_token=$(printf '%s' "$token" | python3 -c "import sys, urllib.parse; print(urllib.parse.quote(sys.stdin.read().strip(), safe=''))")
    
    # Configure git to use Bearer token authentication
    git config --global http.extraHeader "Authorization: Bearer $token"
    
    # Try clone or init
    if git clone "http://$bitbucket_host/scm/$project_key_lower/$REPO_NAME.git" 2>/dev/null; then
        cd "$REPO_NAME"
        log_info "Repository cloned successfully"
    else
        log_info "Repository empty, initializing..."
        mkdir "$REPO_NAME"
        cd "$REPO_NAME"
        git init
        git remote add origin "http://$bitbucket_host/scm/$project_key_lower/$REPO_NAME.git"
    fi
    
    # Configure git and create test file
    git config user.name "Integration Test"
    git config user.email "test@integration.local"
    
    # Set default branch name
    git config init.defaultBranch "$BRANCH"
    
    echo "# Integration Test" > INTEGRATION_TEST.md
    echo "Test commit created at: $(date)" >> INTEGRATION_TEST.md
    echo "Repository: $REPOSITORY_KEY" >> INTEGRATION_TEST.md
    echo "Branch: $BRANCH" >> INTEGRATION_TEST.md
    
    git add INTEGRATION_TEST.md
    git commit -m "Integration test commit - $(date +%Y%m%d-%H%M%S)"
    
    # Rename current branch to target branch if different
    local current_branch
    current_branch=$(git branch --show-current)
    if [ "$current_branch" != "$BRANCH" ]; then
        git branch -m "$current_branch" "$BRANCH"
    fi
    
    # Try push with multiple strategies
    local push_success=false
    local push_error=""
    local push_exit_code=0
    
    # Test connectivity and token validity first
    log_info "Testing connectivity to Bitbucket Server..."
    if ! curl -s --max-time 10 "$BITBUCKET_URL/status" > /dev/null; then
        log_error "Bitbucket Server not responding"
        return 1
    fi
    
    # Test token validity using Bearer token with application properties endpoint
    log_info "Testing token validity..."
    local token_test
    token_test=$(curl -s --max-time 10 -H "Authorization: Bearer $token" "$BITBUCKET_URL/rest/api/1.0/application-properties" 2>/dev/null)
    if echo "$token_test" | grep -q '"errors"'; then
        log_error "Token authentication failed. Token may be invalid or expired."
        log_error "Token test response: $token_test"
        return 1
    elif echo "$token_test" | grep -q '"version"'; then
        log_success "Token is valid"
    else
        log_warning "Token test inconclusive, continuing anyway"
        log_info "Token test response: $token_test"
    fi
    
    # Try specified branch first
    log_info "Trying to push to branch: $BRANCH"
    log_info "Current branch: $(git branch --show-current)"
    log_info "Remote URL: $(git remote get-url origin)"
    log_info "Using Bearer token authentication"
    
    # Use timeout with background process to avoid hanging
    log_info "Starting git push (with 60s timeout)..."
    (
        git push --set-upstream origin "$BRANCH" 2>&1
    ) &
    local git_pid=$!
    
    # Wait for git process with timeout
    local timeout_count=0
    while kill -0 $git_pid 2>/dev/null && [ $timeout_count -lt 60 ]; do
        sleep 1
        ((timeout_count++))
        if [ $((timeout_count % 10)) -eq 0 ]; then
            log_info "Push in progress... (${timeout_count}s)"
        fi
    done
    
    if kill -0 $git_pid 2>/dev/null; then
        log_error "Git push timed out after 60 seconds, killing process"
        kill -9 $git_pid 2>/dev/null
        push_error="Git push timed out after 60 seconds"
        push_exit_code=124
    else
        wait $git_pid
        push_exit_code=$?
        if [ $push_exit_code -eq 0 ]; then
            push_error=""
        else
            push_error="Git push failed with exit code $push_exit_code"
        fi
    fi
    push_exit_code=$?
    if [ $push_exit_code -eq 0 ]; then
        push_success=true
        log_success "Test commit pushed successfully to $BRANCH"
    else
        log_error "Push to $BRANCH failed (exit code: $push_exit_code)"
        log_error "Git error output:"
        if [ -n "$push_error" ]; then
            echo "$push_error"
        else
            log_error "  No error output captured"
        fi
        
        # Try master if different from specified branch
        if [ "$BRANCH" != "master" ]; then
            log_info "Trying to push to branch: master"
            log_info "Switching to master branch"
            git checkout -b master 2>/dev/null || git checkout master 2>/dev/null
            log_info "Current branch: $(git branch --show-current)"
            push_error=$(git push --set-upstream origin master 2>&1)
            push_exit_code=$?
            if [ $push_exit_code -eq 0 ]; then
                push_success=true
                log_success "Test commit pushed successfully to master"
            else
                log_error "Push to master failed (exit code: $push_exit_code)"
                log_error "Git error output:"
                if [ -n "$push_error" ]; then
                    echo "$push_error"
                else
                    log_error "  No error output captured"
                fi
            fi
        fi
        
        # Try main if not tried yet
        if [ "$BRANCH" != "main" ] && [ "$push_success" = false ]; then
            log_info "Trying to push to branch: main"
            log_info "Switching to main branch"
            git checkout -b main 2>/dev/null || git checkout main 2>/dev/null
            log_info "Current branch: $(git branch --show-current)"
            push_error=$(git push --set-upstream origin main 2>&1)
            push_exit_code=$?
            if [ $push_exit_code -eq 0 ]; then
                push_success=true
                log_success "Test commit pushed successfully to main"
            else
                log_error "Push to main failed (exit code: $push_exit_code)"
                log_error "Git error output:"
                if [ -n "$push_error" ]; then
                    echo "$push_error"
                else
                    log_error "  No error output captured"
                fi
            fi
        fi
    fi
    
    # Show final push status
    if [ "$push_success" = false ]; then
        log_error "All push attempts failed. Last error:"
        log_error "$push_error"
        log_info "Repository URL: http://$bitbucket_host/scm/$project_key_lower/$REPO_NAME.git"
        log_info "Check if repository exists and credentials are correct"
    fi
    
    if [ "$push_success" = true ]; then
        log_info "Waiting for webhook processing..."
        sleep 10
        
        # Check pipeline execution
        local pipeline_name="$(echo "$PROJECT_KEY-$REPO_NAME-pipeline" | tr '[:upper:]' '[:lower:]')"
        local executions
        executions=$(aws codepipeline list-pipeline-executions \
            --region "$AWS_REGION" \
            --pipeline-name "$pipeline_name" \
            --max-items 1 \
            --query 'pipelineExecutionSummaries[0].status' \
            --output text 2>/dev/null || echo "")
        
        if [ -n "$executions" ]; then
            log_success "Pipeline execution detected: $executions"
        else
            log_warning "No recent pipeline executions found"
            
            # Check if source file exists in S3
            local s3_bucket
            s3_bucket=$(aws cloudformation describe-stacks \
                --region "$AWS_REGION" \
                --stack-name BitbucketIntegrationV2Stack-${ENVIRONMENT} \
                --query 'Stacks[0].Outputs[?OutputKey==`SourcesBucketName`].OutputValue' \
                --output text 2>/dev/null || echo "")
            
            if [ -n "$s3_bucket" ]; then
                log_info "Checking S3 bucket for source files..."
                local s3_objects
                s3_objects=$(aws s3 ls "s3://$s3_bucket/repositories/$PROJECT_KEY/$REPO_NAME/" --recursive 2>/dev/null || echo "")
                
                if [ -n "$s3_objects" ]; then
                    log_info "Found files in S3:"
                    echo "$s3_objects" | while IFS= read -r line; do
                        log_info "  $line"
                    done
                else
                    log_warning "No files found in S3 bucket for this repository"
                    log_info "Check CloudWatch logs: /aws/lambda/bitbucket-webhook-handler-v2"
                    log_info "Check CloudWatch logs: /aws/lambda/bitbucket-repository-processor-v2"
                fi
            fi
        fi
    else
        log_error "Failed to push test commit after all attempts"
        log_error "This may indicate:"
        log_error "  1. Token lacks repository write permissions"
        log_error "  2. Repository doesn't exist or is not accessible"
        log_error "  3. Network connectivity issues"
        log_error "  4. Bitbucket Server configuration problems"
    fi
    
    # Cleanup
    cd /
    rm -rf "$temp_dir"
    log_success "Integration test completed"
}

# Generate summary
generate_summary() {
    log_step "📋 Generating configuration summary..."
    
    local summary_file="$HOME/repository-setup-summary-$(date +%Y%m%d-%H%M%S).txt"
    [ ! -w "$HOME" ] && summary_file="/tmp/repository-setup-summary-$(date +%Y%m%d-%H%M%S).txt"
    
    cat > "$summary_file" << EOF
# Repository Setup Summary

## Configuration Information
- Date: $(date)
- Repository: $REPOSITORY_KEY
- Branch: $BRANCH
- AWS Region: $AWS_REGION

## Resources Created
- Bitbucket Project: $PROJECT_KEY
- Bitbucket Repository: $REPO_NAME
- Pipeline: $(echo "$PROJECT_KEY-$REPO_NAME-pipeline" | tr '[:upper:]' '[:lower:]')
- Webhook Secret: bitbucket-integration-v2/webhook-secrets/$PROJECT_KEY-$REPO_NAME
- DynamoDB Mapping: $PROJECT_KEY/$REPO_NAME/$BRANCH

## Integration
- Bitbucket URL: $BITBUCKET_URL/projects/$PROJECT_KEY/repos/$REPO_NAME
- Webhook Endpoint: $WEBHOOK_ENDPOINT

## Next Steps
1. Push code to repository
2. Monitor pipeline executions in AWS Console
3. Check CloudWatch logs for webhook processing
EOF
    
    log_success "Summary saved to: $summary_file"
}

# Main function
main() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    Bitbucket Integration V2 - Repository Setup              ║"
    echo "║                          Unified Configuration Tool                          ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
    
    parse_arguments "$@"
    setup_environment
    
    # Handle global-only setup
    if [ "$GLOBAL_ONLY" = true ]; then
        setup_global_bitbucket_config
        log_success "Global setup completed successfully!"
        return 0
    fi
    
    # Check and perform global setup if needed
    if ! check_global_setup; then
        log_info "Performing global setup first..."
        setup_global_bitbucket_config
    else
        load_deployment_info
        get_user_credentials
    fi
    
    # Repository-specific setup
    log_step "🎯 Starting repository setup for: $REPOSITORY_KEY"
    
    if [ "$FULL_SETUP" = true ] || [ "$REPO_ONLY" = true ]; then
        create_bitbucket_project
        create_bitbucket_repository
    fi
    
    if [ "$FULL_SETUP" = true ] || [ "$PIPELINE_ONLY" = true ]; then
        create_codepipeline
        register_in_dynamodb
    fi
    
    if [ "$FULL_SETUP" = true ] || [ "$WEBHOOK_ONLY" = true ]; then
        local webhook_secret
        webhook_secret=$(generate_repository_webhook_secret 2>/dev/null)
        log_info "Generated webhook secret: $webhook_secret"
        configure_repository_webhook "$webhook_secret"
    fi
    
    if [ "$FULL_SETUP" = true ]; then
        test_integration
    fi
    
    generate_summary
    
    log_success "Repository setup completed successfully!"
    log_info "Repository: $REPOSITORY_KEY is ready for use"
}

# Cleanup on exit
cleanup_on_exit() {
    log_warning "Script interrupted. Cleaning up temporary files..."
    rm -f /tmp/bitbucket-token-*.txt
}

trap cleanup_on_exit EXIT

# Run main function
main "$@"