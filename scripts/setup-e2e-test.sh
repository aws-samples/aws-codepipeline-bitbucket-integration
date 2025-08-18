#!/bin/bash

set -eE

# Determine important directories
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"
PIPELINE_FACTORY_DIR="$PROJECT_ROOT/infra/pipeline-factory"
MY_DIR=$(pwd)

# Verify directories exist
echo "🔍 Verifying directory structure..."
echo "   - Script dir: $SCRIPT_DIR"
echo "   - Project root: $PROJECT_ROOT" 
echo "   - Pipeline factory: $PIPELINE_FACTORY_DIR"

if [ ! -d "$PIPELINE_FACTORY_DIR" ]; then
    echo "❌ Pipeline factory directory not found: $PIPELINE_FACTORY_DIR"
    echo "   Listing infra directory content:"
    ls -la "$PROJECT_ROOT/infra/" 2>/dev/null || echo "   Cannot list infra/ directory"
    exit 1
fi

# Function to generate random strings safely
generate_random_string() {
    local length=${1:-3}
    LC_ALL=C < /dev/urandom tr -dc 'a-z' | head -c "$length" || echo "xyz${RANDOM:0:3}"
}

# Function to make API requests to Bitbucket with proper authentication
make_bitbucket_request() {
    local method=$1
    local endpoint=$2
    local data=$3
    local use_token=${4:-$USE_TOKEN}
    
    local response
    
    # Try token authentication first if available
    if [ "$use_token" = true ] && [ -n "$BITBUCKET_TOKEN" ]; then
        if [ "$USE_BEARER_AUTH" = true ]; then
            response=$(curl -s -H "Authorization: Bearer $BITBUCKET_TOKEN" -X "$method" \
                "$BITBUCKET_URL$endpoint" \
                -H "Content-Type: application/json" \
                ${data:+-d "$data"})
        else
            response=$(curl -s -u "$BITBUCKET_USER:$BITBUCKET_TOKEN" -X "$method" \
                "$BITBUCKET_URL$endpoint" \
                -H "Content-Type: application/json" \
                ${data:+-d "$data"})
        fi
        
        # Check if token auth failed and retry with password
        if echo "$response" | grep -q "AuthorisationException\|Unauthorized\|401"; then
            echo "⚠️ Token authentication failed, retrying with password..." >&2
            response=$(curl -s -u "$BITBUCKET_USER:$BITBUCKET_PASS" -X "$method" \
                "$BITBUCKET_URL$endpoint" \
                -H "Content-Type: application/json" \
                ${data:+-d "$data"})
        fi
    else
        response=$(curl -s -u "$BITBUCKET_USER:$BITBUCKET_PASS" -X "$method" \
            "$BITBUCKET_URL$endpoint" \
            -H "Content-Type: application/json" \
            ${data:+-d "$data"})
    fi
    
    echo "$response"
}

# Function to URL encode password for Git operations
url_encode_password() {
    local password=$1
    if command -v python3 &> /dev/null; then
        python3 -c "import urllib.parse; print(urllib.parse.quote('$password', safe=''))"
    elif command -v jq &> /dev/null; then
        printf %s "$password" | jq -sRr @uri
    else
        # Basic encoding for common special characters
        echo "$password" | sed 's/@/%40/g; s/:/%3A/g; s/ /%20/g; s/!/%21/g; s/#/%23/g; s/\$/%24/g; s/&/%26/g; s/+/%2B/g'
    fi
}

# Function to handle special characters in password
handle_special_characters_in_password() {
    echo "⚠️ Password contains special characters that might need encoding"
    echo "🔍 Attempting to URL-encode special characters..."
    local encoded_pass=$(url_encode_password "$BITBUCKET_PASS")
    echo "🔍 Testing with URL-encoded password..."
    local url_enc_test=$(curl -s -u "$BITBUCKET_USER:$encoded_pass" \
        "$BITBUCKET_URL/rest/api/1.0/application-properties")
    
    if echo "$url_enc_test" | grep -q "version"; then
        echo "✅ Authentication successful with URL-encoded password"
        BITBUCKET_PASS="$encoded_pass"
        return 0
    else
        echo "❌ URL encoding did not resolve authentication issue"
        return 1
    fi
}

# Function to check admin permissions
check_admin_permissions() {
    echo "🔍 Checking admin permissions..."
    local admin_test=$(make_bitbucket_request "GET" "/rest/api/1.0/admin/permissions/users?filter=$BITBUCKET_USER")
    
    if ! echo "$admin_test" | grep -q "ADMIN"; then
        echo "⚠️ User may not have required admin permissions"
        echo "🔍 Response: $admin_test"
        echo -n "❓ Continue anyway? (y/N): "
        read -r CONTINUE
        if [[ ! "$CONTINUE" =~ ^[Yy]$ ]]; then
            echo "❌ Execution cancelled by user"
            exit 1
        fi
    else
        echo "✅ User has admin permissions"
    fi
}

# Function to validate Bitbucket credentials
validate_bitbucket_credentials() {
    echo "🔍 Validating Bitbucket credentials..."
    
    local cred_test=$(make_bitbucket_request "GET" "/rest/api/1.0/application-properties")
    
    if echo "$cred_test" | grep -q "version"; then
        echo "✅ Bitbucket credentials validated successfully"
        echo "🔍 Server version: $(echo "$cred_test" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p')"
        
        # Check if password contains special characters
        if [[ "$BITBUCKET_PASS" =~ [^a-zA-Z0-9] ]]; then
            handle_special_characters_in_password
        fi
        
        # Test admin permissions
        check_admin_permissions
        
        return 0
    else
        echo "❌ Bitbucket authentication failed"
        echo "🔍 Response: $cred_test"
        echo "🔧 Check username and password and try again"
        return 1
    fi
}

# Function to validate AWS credentials early
validate_aws_credentials_early() {
    echo "🔑 Validating AWS credentials..."
    
    local caller_identity
    caller_identity=$(aws sts get-caller-identity 2>&1)
    local status=$?
    
    if [ $status -ne 0 ]; then
        echo "❌ AWS credentials validation failed"
        
        if echo "$caller_identity" | grep -q "ExpiredTokenException\|TokenRefreshRequired\|expired"; then
            echo "🕐 Your AWS credentials have expired"
            echo "🔄 Please refresh your credentials and try again:"
            echo "  - For SSO: aws sso login --profile your-profile"
            echo "  - For regular credentials: aws configure"
        elif echo "$caller_identity" | grep -q "NoCredentialsError\|Unable to locate credentials"; then
            echo "🔐 No AWS credentials found"
            echo "🔧 Please configure AWS credentials:"
            echo "  - Run: aws configure"
            echo "  - Or set environment variables: AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY"
        else
            echo "🔍 Error details: $caller_identity"
        fi
        
        exit 1
    fi
    
    echo "✅ AWS credentials validated successfully"
    echo ""
}

# Function to validate AWS credentials
validate_aws_credentials() {
    echo "🔑 Checking AWS credentials..."
    
    if ! aws sts get-caller-identity &>/dev/null; then
        echo ""
        echo "❌ AWS credentials validation failed"
        echo "📝 Error details:"
        echo "  - No valid AWS credentials found in the environment"
        echo "  - Or the configured credentials don't have sufficient permissions"
        echo ""
        echo "🔍 To fix this issue:"
        echo "  - Make sure you have configured AWS credentials (aws configure)"
        echo "  - Verify that your credentials have not expired"
        echo "  - Check that you have the necessary permissions for CloudFormation, ECS, etc."
        echo "  - You may need to run 'aws sso login' if using SSO"
        echo ""
        echo "🔄 Once your credentials are properly configured, try running this script again."
        exit 1
    fi
    
    echo "✅ AWS credentials validated successfully"
    echo ""
}

# Function to select region
select_region() {
    echo "🌍 AWS Region Selection"
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
        1) AWS_REGION="us-east-1";;
        3) AWS_REGION="us-west-1";;
        4) AWS_REGION="us-west-2";;
        5) AWS_REGION="eu-west-1";;
        6) AWS_REGION="ap-southeast-1";;
        7) 
            read -p "Enter custom region: " custom_region
            if [ -n "$custom_region" ]; then
                AWS_REGION="$custom_region"
            else
                echo "Invalid region. Using default: us-east-2"
                AWS_REGION="us-east-2"
            fi
            ;;
        2|""|"") AWS_REGION="us-east-2";; # Default to us-east-2
        *) echo "Invalid selection. Using default: us-east-2"; AWS_REGION="us-east-2";;
    esac
    
    echo "✅ Selected region: $AWS_REGION"
    echo ""
}

# Function to create Bitbucket project
create_bitbucket_project() {
    echo "📁 Creating project $TEST_PROJECT..."
    
    local project_data="{
        \"key\": \"$TEST_PROJECT\",
        \"name\": \"$TEST_PROJECT Project\",
        \"description\": \"E2E Test Project\"
    }"
    
    local project_response=$(make_bitbucket_request "POST" "/rest/api/1.0/projects" "$project_data")
    
    if echo "$project_response" | grep -q "\"key\":\"$TEST_PROJECT\"" || \
       echo "$project_response" | grep -q "\"id\":" || \
       echo "$project_response" | grep -q "\"name\":\"$TEST_PROJECT Project\""; then
        echo "✅ Project $TEST_PROJECT created successfully"
        BITBUCKET_PROJECT_CREATED=true
        
        # Extract project ID for logging
        local project_id=$(echo "$project_response" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
        if [ -n "$project_id" ]; then
            echo "🔍 Project ID: $project_id"
        fi
        return 0
    elif echo "$project_response" | grep -q "already exists"; then
        echo "✅ Project $TEST_PROJECT already exists"
        BITBUCKET_PROJECT_CREATED=true
        return 0
    elif echo "$project_response" | grep -q "AuthorisationException"; then
        echo "❌ Authorization error: Token does not have permissions to create projects"
        return 1
    else
        echo "❌ Failed to create project: $project_response"
        return 1
    fi
}

# Function to create Bitbucket repository
create_bitbucket_repository() {
    echo "📂 Creating repository $TEST_REPO..."
    
    local repo_data="{
        \"name\": \"$TEST_REPO\",
        \"scmId\": \"git\",
        \"defaultBranch\": \"main\",
        \"forkable\": true
    }"
    
    local repo_response=$(make_bitbucket_request "POST" "/rest/api/1.0/projects/$TEST_PROJECT/repos" "$repo_data")
    
    if echo "$repo_response" | grep -q "\"name\":\"$TEST_REPO\""; then
        echo "✅ Repository $TEST_REPO created"
        BITBUCKET_REPO_CREATED=true
        return 0
    elif echo "$repo_response" | grep -q "already taken"; then
        echo "✅ Repository $TEST_REPO already exists"
        BITBUCKET_REPO_CREATED=true
        return 0
    elif echo "$repo_response" | grep -q "AuthorisationException"; then
        echo "❌ Authorization error: Token does not have permissions to create repositories"
        return 1
    else
        echo "❌ Failed to create repository: $repo_response"
        return 1
    fi
}

# Function to create initial commit via API
create_initial_commit_via_api() {
    echo "🔍 Creating initial commit via Bitbucket API..."
    
    # Try to create README.md first
    local readme_content="# E2E Test Repository\nThis repository is used for end-to-end testing.\nCreated: $(date)"
    local commit_data="{
        \"content\": \"$readme_content\",
        \"message\": \"Initial commit - Add README\",
        \"branch\": \"main\"
    }"
    
    local commit_response=$(make_bitbucket_request "PUT" "/rest/api/1.0/projects/$TEST_PROJECT/repos/$TEST_REPO/browse/README.md" "$commit_data")
    
    if echo "$commit_response" | grep -q "\"id\":\|\"path\":"; then
        echo "✅ Initial commit created via API"
        
        # Try to add a test file as well
        local test_content="Sample test content for E2E testing\nTimestamp: $(date)"
        local test_data="{
            \"content\": \"$test_content\",
            \"message\": \"Add test file\",
            \"branch\": \"main\"
        }"
        
        local test_response=$(make_bitbucket_request "PUT" "/rest/api/1.0/projects/$TEST_PROJECT/repos/$TEST_REPO/browse/test.txt" "$test_data")
        
        if echo "$test_response" | grep -q "\"id\":\|\"path\":"; then
            echo "✅ Test file added via API"
        else
            echo "⚠️ Could not add test file, but README was created"
        fi
        
        return 0
    else
        echo "❌ Failed to create initial commit via API"
        echo "Response: $commit_response"
        
        # Check if it's an authorization issue
        if echo "$commit_response" | grep -q "AuthorisationException\|Unauthorized"; then
            echo "❌ Authorization error: Token/user does not have write permissions"
        elif echo "$commit_response" | grep -q "already exists"; then
            echo "✅ File already exists - repository has content"
            return 0
        fi
        
        echo "⚠️ E2E tests may fail due to empty repository"
        return 1
    fi
}

# Function to validate git credentials
validate_git_credentials() {
    local repo_url=$1
    echo "🔍 Testing Git connectivity..."
    
    if git ls-remote "$repo_url" HEAD &>/dev/null; then
        echo "✅ Git credentials validated"
        return 0
    else
        echo "❌ Git credentials validation failed"
        return 1
    fi
}

# Function to create initial content in repository
create_initial_content() {
    echo "📝 Creating initial content in repository..."
    local temp_repo_dir="/tmp/setup-e2e-repo-$$"
    mkdir -p "$temp_repo_dir"
    cd "$temp_repo_dir"
    
    git init --initial-branch=main
    git config user.name "E2E Setup"
    git config user.email "e2e@test.com"
    
    # Create comprehensive test content
    echo "# E2E Test Repository" > README.md
    echo "This repository is used for end-to-end testing." >> README.md
    echo "Created: $(date)" >> README.md
    echo "" >> README.md
    echo "## Test Files" >> README.md
    echo "- README.md: This file" >> README.md
    echo "- test.txt: Sample test file" >> README.md
    
    echo "Sample test content for E2E testing" > test.txt
    echo "Timestamp: $(date)" >> test.txt
    
    git add .
    git commit -m "Initial commit for E2E testing

Added:
- README.md with project description
- test.txt with sample content"
    
    local bitbucket_host=$(echo "$BITBUCKET_URL" | sed 's|http://||' | sed 's|https://||')
    local repo_url
    
    # Try different authentication methods with proper URL encoding
    if [ "$USE_TOKEN" = true ] && [ -n "$BITBUCKET_TOKEN" ]; then
        echo "🔑 Using token authentication for Git operations"
        local encoded_token=$(url_encode_password "$BITBUCKET_TOKEN")
        repo_url="http://$BITBUCKET_USER:$encoded_token@$bitbucket_host/scm/$TEST_PROJECT/$TEST_REPO.git"
    else
        echo "🔑 Using password authentication for Git operations"
        local encoded_pass=$(url_encode_password "$BITBUCKET_PASS")
        repo_url="http://$BITBUCKET_USER:$encoded_pass@$bitbucket_host/scm/$TEST_PROJECT/$TEST_REPO.git"
    fi
    
    # echo "🔍 Using Git repository URL: ${repo_url//$BITBUCKET_TOKEN/<TOKEN>}"
    echo "🔍 Using Git repository URL: ${repo_url//$BITBUCKET_PASS/<PASSWORD>}"
    
    # Validate credentials before attempting push
    if ! validate_git_credentials "$repo_url"; then
        echo "⚠️ Git credentials validation failed, trying alternative methods..."
        
        # Try with password if token failed
        if [ "$USE_TOKEN" = true ]; then
            echo "🔄 Retrying with password authentication..."
            local encoded_pass=$(url_encode_password "$BITBUCKET_PASS")
            repo_url="http://$BITBUCKET_USER:$encoded_pass@$bitbucket_host/scm/$TEST_PROJECT/$TEST_REPO.git"
            
            if ! validate_git_credentials "$repo_url"; then
                echo "❌ All authentication methods failed"
                echo "🔧 Falling back to API method"
                create_initial_commit_via_api
                return $?
            fi
        else
            echo "❌ Password authentication failed"
            echo "🔧 Falling back to API method"
            create_initial_commit_via_api
            return $?
        fi
    fi
    
    echo "🔗 Adding remote origin..."
    git remote add origin "$repo_url"
    
    echo "📤 Pushing initial content to main branch..."
    if git push -u origin main; then
        echo "✅ Initial content successfully pushed to repository"
        # Clean up temporary directory
        cd "$MY_DIR"
        rm -rf "$temp_repo_dir"
        return 0
    else
        echo "❌ Failed to push initial content to repository"
        echo "🔍 This will cause E2E tests to fail - repository must have content"
        # Clean up temporary directory before API fallback
        cd "$MY_DIR"
        rm -rf "$temp_repo_dir"
        create_initial_commit_via_api
        return $?
    fi
}

# Function to verify repository
verify_repository() {
    echo "🔍 Final repository verification..."
    local verify_response=$(make_bitbucket_request "GET" "/rest/api/1.0/projects/$TEST_PROJECT/repos/$TEST_REPO")
    
    if echo "$verify_response" | grep -q "\"name\":\"$TEST_REPO\""; then
        echo "✅ Repository verification successful"
        return 0
    else
        echo "❌ Repository verification failed - E2E tests will fail"
        echo "Response: $verify_response"
        return 1
    fi
}

# Function to get resource from CloudFormation outputs
get_cloudformation_output() {
    local stack_name=$1
    local output_key=$2
    local default_value=${3:-""}
    
    local output_value=$(aws cloudformation describe-stacks \
      --region $AWS_REGION \
      --stack-name "$stack_name" \
      --query "Stacks[0].Outputs[?OutputKey=='$output_key'].OutputValue" \
      --output text 2>/dev/null || echo "")
    
    if [ -z "$output_value" ] || [ "$output_value" = "None" ]; then
        echo "$default_value"
    else
        echo "$output_value"
    fi
}

# Function to check if stack exists
check_stack_exists() {
    aws cloudformation describe-stacks --region $AWS_REGION --stack-name "$1" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND"
}

# Function to deploy test pipeline
deploy_test_pipeline() {
    echo "🚀 Deploying test pipeline..."
    
    # Check if stack already exists
    local stack_status=$(check_stack_exists "$STACK_NAME")
    
    if [ "$stack_status" != "NOT_FOUND" ]; then
        echo "✅ Pipeline stack already exists ($stack_status) - checking if update needed..."
        
        # Navigate to pipeline factory directory using absolute path
        echo "🔍 Changing directory to pipeline factory"
        cd "$PIPELINE_FACTORY_DIR" || {
            echo "❌ Failed to change directory to pipeline factory"
            echo "🔍 Current directory: $(pwd)"
            echo "🔍 Script directory: $SCRIPT_DIR"
            echo "🔍 Project root: $PROJECT_ROOT"
            echo "🔍 Target directory: $PIPELINE_FACTORY_DIR"
            ls -la "$PROJECT_ROOT/infra/" 2>/dev/null || echo "Cannot list infra/ directory"
            return 1
        }
        echo "✅ Successfully changed directory to: $(pwd)"
        
        # Check for differences
        local diff_output=$(npx cdk diff \
          -c pipelineName="$PIPELINE_NAME" \
          -c repositoryKey="$REPOSITORY_KEY" \
          -c branch="main" \
          -c sourceBucket="$SOURCES_BUCKET" \
          -c artifactsBucket="$ARTIFACTS_BUCKET" \
          -c environment="$ENVIRONMENT" 2>&1)
        
        if echo "$diff_output" | grep -q "There were no differences"; then
            echo "✅ Stack is up to date - no changes needed"
            return 0
        else
            echo "🔄 Stack differences detected:"
            echo "$diff_output"
            echo ""
            echo -n "❓ Do you want to apply these changes? (y/N): "
            read -r APPLY_CHANGES
            
            if [ "$APPLY_CHANGES" = "y" ] || [ "$APPLY_CHANGES" = "Y" ]; then
                echo "🚀 Applying changes..."
                # Export AWS_REGION for CDK to use
                export AWS_REGION="$AWS_REGION"
                npx cdk deploy \
                  -c pipelineName="$PIPELINE_NAME" \
                  -c repositoryKey="$REPOSITORY_KEY" \
                  -c branch="main" \
                  -c sourceBucket="$SOURCES_BUCKET" \
                  -c artifactsBucket="$ARTIFACTS_BUCKET" \
                  -c environment="$ENVIRONMENT" \
                  --require-approval never
                echo "✅ Pipeline updated successfully!"
                return 0
            else
                echo "❌ Changes cancelled by user"
                return 1
            fi
        fi
    else
        # Navigate to pipeline factory directory using absolute path
        echo "🔍 Changing directory to pipeline factory"
        cd "$PIPELINE_FACTORY_DIR" || {
            echo "❌ Failed to change directory to pipeline factory"
            echo "🔍 Current directory: $(pwd)"
            echo "🔍 Script directory: $SCRIPT_DIR"
            echo "🔍 Project root: $PROJECT_ROOT"
            echo "🔍 Target directory: $PIPELINE_FACTORY_DIR"
            ls -la "$PROJECT_ROOT/infra/" 2>/dev/null || echo "Cannot list infra/ directory"
            return 1
        }
        echo "✅ Successfully changed directory to: $(pwd)"
        
        # Install dependencies if needed
        if [ ! -d "node_modules" ]; then
            echo "📦 Installing dependencies..."
            npm install
        fi
        
        # Build TypeScript
        echo "🔨 Building TypeScript..."
        npm run build
        
        # Deploy stack
        echo "🚀 Deploying pipeline..."
        # Export AWS_REGION for CDK to use
        export AWS_REGION="$AWS_REGION"
        npx cdk deploy \
          -c pipelineName="$PIPELINE_NAME" \
          -c repositoryKey="$REPOSITORY_KEY" \
          -c branch="main" \
          -c sourceBucket="$SOURCES_BUCKET" \
          -c artifactsBucket="$ARTIFACTS_BUCKET" \
          -c environment="$ENVIRONMENT" \
          --require-approval never
        
        local deploy_status=$?
        if [ $deploy_status -eq 0 ]; then
            echo "✅ Test pipeline deployed successfully!"
            return 0
        else
            echo "❌ Pipeline deployment failed with status: $deploy_status"
            return 1
        fi
    fi
}

# Function to get webhook secret
get_webhook_secret() {
    echo "🔐 Getting webhook secret from pipeline..." >&2
    local secret_string=$(aws secretsmanager get-secret-value \
      --region $AWS_REGION \
      --secret-id "bitbucket-integration-v2/$ENVIRONMENT/webhook-secret/$REPOSITORY_KEY" \
      --query 'SecretString' --output text 2>/dev/null || echo "")

    if [ -n "$secret_string" ] && [ "$secret_string" != "None" ]; then
        # Use sed to extract the secret from JSON
        local webhook_secret=$(echo "$secret_string" | sed -n 's/.*"secret":"\([^"]*\)".*/\1/p')
        
        if [ -n "$webhook_secret" ] && [ ${#webhook_secret} -eq 64 ]; then
            echo "✅ Webhook secret obtained from pipeline (${#webhook_secret} chars)" >&2
            echo "$webhook_secret"
            return 0
        else
            echo "❌ Invalid webhook secret" >&2
            echo "🔍 Secret obtained: '${webhook_secret:-EMPTY}'" >&2
            echo "🔍 Length: ${#webhook_secret} (expected: 64)" >&2
            echo "🔍 Original JSON: $secret_string" >&2
            return 1
        fi
    else
        echo "❌ Secret not found in Secrets Manager" >&2
        echo "🔍 Checking if secret exists..." >&2
        aws secretsmanager describe-secret --secret-id "bitbucket-integration-v2/$ENVIRONMENT/webhook-secret/$REPOSITORY_KEY" --region $AWS_REGION 2>/dev/null || {
            echo "❌ Secret does not exist in Secrets Manager" >&2
            echo "🔧 Check if the pipeline was deployed correctly" >&2
        }
        return 1
    fi
}

# Function to validate URL format
validate_url() {
    local url=$1
    if [[ "$url" =~ ^https?://[a-zA-Z0-9.-]+[a-zA-Z0-9]+(:[0-9]+)?(/.*)?$ ]]; then
        return 0
    else
        return 1
    fi
}

# Function to sanitize URL
sanitize_url() {
    local url=$1
    # Remove any whitespace and carriage returns
    url=$(echo "$url" | tr -d '\n\r\t ' | sed 's/[[:space:]]//g')
    
    # Remove duplicate slashes except after protocol
    url=$(echo "$url" | sed 's|://|PROTOCOL_SEPARATOR|g' | sed 's|//|/|g' | sed 's|PROTOCOL_SEPARATOR|://|g')
    
    # Remove trailing slash
    url=${url%/}
    
    echo "$url"
}

# Function to get webhook endpoint
get_webhook_endpoint() {
    echo "🔍 Getting webhook endpoint..." >&2
    local webhook_endpoint=$(get_cloudformation_output "BitbucketIntegrationV2Stack-$ENVIRONMENT" "WebhookEndpoint")

    if [ -z "$webhook_endpoint" ] || [ "$webhook_endpoint" = "None" ]; then
        echo "⚠️ Webhook endpoint not found in CloudFormation outputs" >&2
        echo "🔍 Trying to get endpoint from API Gateway..." >&2
        
        # Try to get from API Gateway directly
        local api_id=$(aws apigateway get-rest-apis \
          --region $AWS_REGION \
          --query "items[?name=='bitbucket-integration-v2-api-$ENVIRONMENT'].id" \
          --output text)
        
        if [ -n "$api_id" ] && [ "$api_id" != "None" ]; then
            webhook_endpoint="https://$api_id.execute-api.$AWS_REGION.amazonaws.com/$ENVIRONMENT/webhook"
            echo "✅ Constructed API endpoint: $webhook_endpoint" >&2
        else
            echo "❌ Could not determine webhook endpoint" >&2
            echo "🔧 Please set the webhook endpoint manually in Bitbucket" >&2
            webhook_endpoint="https://example.com/placeholder"
        fi
    else
        echo "✅ Found webhook endpoint from CloudFormation: $webhook_endpoint" >&2
    fi
    
    # Sanitize the URL to prevent duplication and formatting issues
    webhook_endpoint=$(sanitize_url "$webhook_endpoint")
    
    # Validate the URL format
    if validate_url "$webhook_endpoint"; then
        echo "✅ Webhook endpoint validated: $webhook_endpoint" >&2
    else
        echo "⚠️ Webhook endpoint format may be invalid: $webhook_endpoint" >&2
    fi
    
    # Only echo the final clean URL (this is what gets returned)
    echo "$webhook_endpoint"
}

# Function to test webhook endpoint connectivity
test_webhook_endpoint() {
    local webhook_endpoint=$1
    echo "🔍 Testing webhook endpoint connectivity..."
    
    local test_response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$webhook_endpoint" 2>/dev/null || echo "000")
    
    if [ "$test_response" = "405" ] || [ "$test_response" = "200" ] || [ "$test_response" = "404" ]; then
        echo "✅ Webhook endpoint is reachable (HTTP $test_response)"
        return 0
    else
        echo "⚠️ Webhook endpoint may not be reachable (HTTP $test_response)"
        return 1
    fi
}

# Function to configure webhook
configure_webhook() {
    local webhook_endpoint_raw=$1
    local webhook_secret_raw=$2
    
    # Sanitize inputs
    local webhook_endpoint=$(sanitize_url "$webhook_endpoint_raw")
    local webhook_secret=$(echo "$webhook_secret_raw" | tr -d '\n\r\t ' | sed 's/[[:space:]]//g')
    
    echo "🔗 Configuring webhook to: $webhook_endpoint"
    echo "🔍 Webhook secret length: ${#webhook_secret} characters"
    
    # Validate URL format
    if ! validate_url "$webhook_endpoint"; then
        echo "❌ Invalid webhook URL format: $webhook_endpoint"
        echo "   Continuing without webhook..."
        return 1
    fi
    
    # Test endpoint connectivity
    test_webhook_endpoint "$webhook_endpoint" || {
        echo "⚠️ Webhook endpoint connectivity test failed, but continuing..."
    }
    
    # Prepare webhook data with proper JSON escaping
    local webhook_data="{\"name\":\"E2E Test Webhook\",\"url\":\"$webhook_endpoint\",\"events\":[\"repo:refs_changed\"],\"configuration\":{\"secret\":\"$webhook_secret\"}}"
    
    echo "🔍 Webhook payload prepared (${#webhook_data} chars)"
    echo "🔍 Making request to: /rest/api/1.0/projects/$TEST_PROJECT/repos/$TEST_REPO/webhooks"
    
    local webhook_response=$(make_bitbucket_request "POST" "/rest/api/1.0/projects/$TEST_PROJECT/repos/$TEST_REPO/webhooks" "$webhook_data" true)
    
    echo "🔍 Webhook response: $webhook_response"
    
    if echo "$webhook_response" | grep -q '"name":"E2E Test Webhook"' || echo "$webhook_response" | grep -q '"id":[0-9]'; then
        echo "✅ Webhook configured successfully"
        
        # Extract webhook ID for verification
        local webhook_id=$(echo "$webhook_response" | sed -n 's/.*"id":\([0-9]*\).*/\1/p')
        if [ -n "$webhook_id" ]; then
            echo "🔍 Webhook ID: $webhook_id"
        fi
        return 0
    elif echo "$webhook_response" | grep -q "AuthorisationException\|Unauthorized"; then
        echo "❌ Authorization error: Token does not have permissions to configure webhooks"
        echo "   Continuing without webhook..."
        return 1
    elif echo "$webhook_response" | grep -q "Please enter a valid URL"; then
        echo "❌ Bitbucket rejected the URL as invalid: $webhook_endpoint"
        echo "🔍 This may be due to URL format or accessibility issues"
        echo "   Continuing without webhook..."
        return 1
    elif echo "$webhook_response" | grep -q "already exists\|duplicate"; then
        echo "✅ Webhook already exists for this repository"
        return 0
    else
        echo "❌ Failed to configure webhook: $webhook_response"
        echo "🔍 URL used: $webhook_endpoint"
        echo "🔍 Secret length: ${#webhook_secret}"
        echo "   Continuing without webhook..."
        return 1
    fi
}

# Function to get DynamoDB table
get_dynamodb_table() {
    echo "🔍 Getting DynamoDB table name..." >&2
    local dynamodb_table=$(get_cloudformation_output "BitbucketIntegrationV2Stack-$ENVIRONMENT" "RepositoryMappingTableName")

    if [ -z "$dynamodb_table" ]; then
        echo "⚠️ DynamoDB table not found in CloudFormation outputs" >&2
        echo "🔍 Trying to find table by name pattern..." >&2
        
        # Try to find table by name pattern
        dynamodb_table=$(aws dynamodb list-tables \
          --region $AWS_REGION \
          --query "TableNames[?contains(@, 'bitbucket-integration-v2-$ENVIRONMENT-repository-mapping')]" \
          --output text)
        
        if [ -z "$dynamodb_table" ] || [ "$dynamodb_table" = "None" ]; then
            echo "❌ DynamoDB table not found" >&2
            return 1
        else
            echo "✅ Found DynamoDB table: $dynamodb_table" >&2
        fi
    else
        echo "✅ Found DynamoDB table: $dynamodb_table" >&2
    fi
    
    echo "$dynamodb_table"
}

# Function to insert mapping in DynamoDB
insert_dynamodb_mapping() {
    local dynamodb_table=$1
    local repository_key=$2
    local pipeline_name=$3
    
    echo "📝 Inserting mapping in DynamoDB..."
    
    if [ -z "$dynamodb_table" ] || [ "$dynamodb_table" = "None" ]; then
        echo "⚠️ DynamoDB table not provided"
        return 1
    fi
    
    local repository_key_with_branch="${repository_key}/main"
    
    aws dynamodb put-item \
      --region $AWS_REGION \
      --table-name "$dynamodb_table" \
      --item "{
        \"repositoryKey\": {\"S\": \"$repository_key_with_branch\"},
        \"pipelineName\": {\"S\": \"$pipeline_name\"},
        \"branch\": {\"S\": \"main\"},
        \"enabled\": {\"BOOL\": true}
      }"
    
    local status=$?
    if [ $status -eq 0 ]; then
        echo "✅ Mapping inserted in DynamoDB"
        return 0
    else
        echo "❌ Failed to insert mapping in DynamoDB"
        return 1
    fi
}

# Function to find actual stack name
find_actual_stack_name() {
    local stack_prefix=$1
    
    echo "🔍 Looking for stack with prefix: $stack_prefix" >&2
    local actual_stack_name=$(aws cloudformation list-stacks \
      --region $AWS_REGION \
      --stack-status-filter CREATE_COMPLETE UPDATE_COMPLETE \
      --query "StackSummaries[?starts_with(StackName, '$stack_prefix')].StackName" \
      --output text)

    if [ -z "$actual_stack_name" ] || [ "$actual_stack_name" = "None" ]; then
        echo "⚠️ Could not find stack with prefix: $stack_prefix" >&2
        echo "🔍 Using original pipeline name: $PIPELINE_NAME" >&2
        echo "$STACK_NAME"
    else
        echo "✅ Stack found: $actual_stack_name" >&2
        
        # Get the real pipeline name from CloudFormation using the correct stack name
        echo "🔍 Getting real pipeline name from CloudFormation..." >&2
        local actual_pipeline_name=$(aws cloudformation describe-stacks \
          --region $AWS_REGION \
          --stack-name "$actual_stack_name" \
          --query 'Stacks[0].Outputs[?OutputKey==`PipelineName`].OutputValue' \
          --output text)
        
        if [ -z "$actual_pipeline_name" ] || [ "$actual_pipeline_name" = "None" ]; then
            echo "⚠️ Could not get real pipeline name from CloudFormation" >&2
            echo "🔍 Using original name: $PIPELINE_NAME" >&2
        else
            echo "✅ Real pipeline name obtained: $actual_pipeline_name" >&2
            # Update the PIPELINE_NAME variable to use the real name
            PIPELINE_NAME="$actual_pipeline_name"
        fi
        
        echo "$actual_stack_name"
    fi
}

# Function to save credentials for E2E test
save_credentials() {
    local stack_name=$1
    
    echo "🔐 Saving credentials for E2E test..."

    # Use only the generated Personal Access Token
    export E2E_BITBUCKET_USER="$BITBUCKET_USER"
    export E2E_BITBUCKET_TOKEN="$BITBUCKET_TOKEN"
    export E2E_BITBUCKET_URL="$BITBUCKET_URL"
    export AWS_DEFAULT_REGION="$AWS_REGION"

    echo "export E2E_BITBUCKET_USER='$BITBUCKET_USER'" > /tmp/e2e-credentials.sh
    echo "export E2E_BITBUCKET_TOKEN='$BITBUCKET_TOKEN'" >> /tmp/e2e-credentials.sh
    echo "export E2E_BITBUCKET_URL='$BITBUCKET_URL'" >> /tmp/e2e-credentials.sh
    echo "export E2E_TEST_PROJECT='$TEST_PROJECT'" >> /tmp/e2e-credentials.sh
    echo "export E2E_TEST_REPO='$TEST_REPO'" >> /tmp/e2e-credentials.sh
    echo "export AWS_DEFAULT_REGION='$AWS_REGION'" >> /tmp/e2e-credentials.sh
    echo "export AWS_TEST_REGION='$AWS_REGION'" >> /tmp/e2e-credentials.sh
    echo "export TEST_ENVIRONMENT='$ENVIRONMENT'" >> /tmp/e2e-credentials.sh
    echo "export PIPELINE_STACK='$stack_name'" >> /tmp/e2e-credentials.sh

    echo "✅ Credentials saved in /tmp/e2e-credentials.sh"
    echo "   Token: ${BITBUCKET_TOKEN:0:10}..."
}

# Function to get token from Secrets Manager
get_token_from_secrets_manager() {
    echo "🔐 Getting token from Secrets Manager..."
    echo "Region: $AWS_REGION"
    echo "Environment: $ENVIRONMENT"
    
    # Try to get token from Secrets Manager
    local token_secret=$(aws secretsmanager get-secret-value \
      --region $AWS_REGION \
      --secret-id "bitbucket-integration-v2/$ENVIRONMENT/token" \
      --query 'SecretString' --output text  || echo "")

    # echo $token_secret
    
    if [ -n "$token_secret" ] && [ "$token_secret" != "None" ]; then
        # Extract token from JSON if needed
        if [[ "$token_secret" == *"token"* ]]; then
            BITBUCKET_TOKEN=$(echo "$token_secret" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
        else
            BITBUCKET_TOKEN="$token_secret"
        fi
        
        echo "✅ Token retrieved from Secrets Manager"
        echo "   Token: ${BITBUCKET_TOKEN:0:10}..."
        
        # Set flag to use token for future requests
        USE_TOKEN=true
        
        # Determine if it's a bearer token (can be customized based on your token format)
        if [[ "$token_secret" == *"bearer"*true* ]]; then
            echo "🔍 Token is a bearer token"
            USE_BEARER_AUTH=true
        else
            echo "🔍 Token is a basic auth token"
            USE_BEARER_AUTH=false
        fi
        
        return 0
    else
        echo "⚠️ Token not found in Secrets Manager"
        return 1
    fi
}

# Function to generate personal access token
generate_personal_access_token() {
    echo "🔐 Checking for existing token or generating a new one..."
    
    # Check if token already exists
    if [ -n "$BITBUCKET_TOKEN" ]; then
        echo "✅ Using existing token"
        return 0
    fi
    
    echo "🔑 Generating new personal access token..."
    local token_data="{
        \"name\": \"E2E Test Token\",
        \"permissions\": [\"PROJECT_ADMIN\", \"REPO_ADMIN\"]
    }"
    
    local token_response=$(make_bitbucket_request "POST" "/rest/access-tokens/1.0/users/$BITBUCKET_USER" "$token_data")
    
    if echo "$token_response" | grep -q "\"token\":"; then
        BITBUCKET_TOKEN=$(echo "$token_response" | sed -n 's/.*"token":"\([^"]*\)".*/\1/p')
        echo "✅ Personal access token generated successfully"
        echo "   Token: ${BITBUCKET_TOKEN:0:10}..."
        
        # Set flag to use token for future requests
        USE_TOKEN=true
        
        # Check if token is bearer token
        if echo "$token_response" | grep -q "\"bearer\":true"; then
            echo "🔍 Token is a bearer token"
            USE_BEARER_AUTH=true
        else
            echo "🔍 Token is a basic auth token"
            USE_BEARER_AUTH=false
        fi
        
        return 0
    elif echo "$token_response" | grep -q "AuthorisationException"; then
        echo "❌ Authorization error: User does not have permissions to create tokens"
        echo "🔧 Continuing with password authentication"
        return 1
    else
        echo "❌ Failed to generate token: $token_response"
        echo "🔧 Continuing with password authentication"
        return 1
    fi
}

# Function to prompt for Bitbucket credentials
prompt_for_bitbucket_credentials() {
    echo "🔑 Bitbucket Credentials"
    echo "======================"
    
    # Prompt for Bitbucket URL
    read -p "Enter Bitbucket URL (e.g., http://localhost:7990): " BITBUCKET_URL
    if [ -z "$BITBUCKET_URL" ]; then
        echo "❌ Bitbucket URL is required"
        exit 1
    fi
    
    # Remove trailing slash if present
    BITBUCKET_URL=${BITBUCKET_URL%/}
    
    # Prompt for username
    read -p "Enter Bitbucket username: " BITBUCKET_USER
    if [ -z "$BITBUCKET_USER" ]; then
        echo "❌ Bitbucket username is required"
        exit 1
    fi
    
    # Prompt for password (hidden input)
    read -s -p "Enter Bitbucket password: " BITBUCKET_PASS
    echo ""
    if [ -z "$BITBUCKET_PASS" ]; then
        echo "❌ Bitbucket password is required"
        exit 1
    fi
    
    echo "✅ Credentials entered"
    echo ""
}

# Function to prompt for environment name
prompt_for_environment() {
    echo "🌐 Environment Selection"
    echo "======================"
    echo "Available environments:"
    echo "  1. dev (development)"
    echo "  2. staging"
    echo "  3. prod (production)"
    echo "  4. custom"
    echo ""
    
    read -p "Select environment (1-4) [default: 1]: " choice
    case $choice in
        2) ENVIRONMENT="staging";;
        3) ENVIRONMENT="prod";;
        4) 
            read -p "Enter custom environment name: " custom_env
            if [ -n "$custom_env" ]; then
                ENVIRONMENT="$custom_env"
            else
                echo "Invalid environment. Using default: dev"
                ENVIRONMENT="dev"
            fi
            ;;
        1|""|"") ENVIRONMENT="dev";; # Default to dev
        *) echo "Invalid selection. Using default: dev"; ENVIRONMENT="dev";;
    esac
    
    echo "✅ Selected environment: $ENVIRONMENT"
    echo ""
}

# Function to clean up resources on error
cleanup_on_error() {
    echo ""
    echo "❌ Error occurred at line $1"
    echo "🧹 Cleaning up resources..."
    
    # Clean up any temporary directories
    rm -rf /tmp/setup-e2e-repo-* 2>/dev/null || true
    
    # Return to original directory
    cd "$MY_DIR" 2>/dev/null || true
    
    # Save error details to file
    echo "Error occurred at $(date)" > /tmp/setup-e2e-error.log
    echo "Line: $1" >> /tmp/setup-e2e-error.log
    echo "Command: $BASH_COMMAND" >> /tmp/setup-e2e-error.log
    echo "Environment: $ENVIRONMENT" >> /tmp/setup-e2e-error.log
    echo "Test Project: $TEST_PROJECT" >> /tmp/setup-e2e-error.log
    echo "Test Repo: $TEST_REPO" >> /tmp/setup-e2e-error.log
    
    echo "📝 Error details saved to /tmp/setup-e2e-error.log"
    echo "🔄 You can run scripts/cleanup-e2e-test.sh to clean up resources"
    
    exit 1
}

# Main execution flow
main() {
    # Set up error handling
    trap 'cleanup_on_error $LINENO' ERR
    
    # Validate AWS credentials early to catch expired tokens
    validate_aws_credentials_early
    
    # Initialize variables
    BITBUCKET_PROJECT_CREATED=false
    BITBUCKET_REPO_CREATED=false
    USE_TOKEN=false
    USE_BEARER_AUTH=false
    AWS_REGION=""
    
    # Generate random names for test resources
    echo "🔄 Using random names for test:"
    TEST_PROJECT=$(generate_random_string 3)
    TEST_REPO=$(generate_random_string 5)
    echo "   - Project: $TEST_PROJECT"
    echo "   - Repository: $TEST_REPO"
    
    # Prompt for credentials and environment
    prompt_for_bitbucket_credentials
    prompt_for_environment
    
    # Validate Bitbucket credentials
    validate_bitbucket_credentials || {
        echo "❌ Failed to validate Bitbucket credentials"
        exit 1
    }
    
    # Validate AWS credentials
    validate_aws_credentials
    
    # Select AWS region
    select_region
    
    # Try to get token from Secrets Manager first, then fall back to generating one if needed
    get_token_from_secrets_manager || {
        echo "⚠️ Failed to get token from Secrets Manager"
        echo "🔧 Falling back to password authentication"
    }
    
    # Set up repository key and pipeline name
    REPOSITORY_KEY="${TEST_PROJECT}/${TEST_REPO}"
    PIPELINE_NAME="Proj${TEST_PROJECT}-Repo${TEST_REPO}-Pipeline"
    STACK_NAME="Pipeline-Proj${TEST_PROJECT}-Repo${TEST_REPO}"
    
    # Get buckets from integration stack
    SOURCES_BUCKET=$(get_cloudformation_output "BitbucketIntegrationV2Stack-$ENVIRONMENT" "SourcesBucketName")
    ARTIFACTS_BUCKET=$(get_cloudformation_output "BitbucketIntegrationV2Stack-$ENVIRONMENT" "ArtifactsBucketName")
    
    if [ -z "$SOURCES_BUCKET" ] || [ -z "$ARTIFACTS_BUCKET" ]; then
        echo "❌ Could not get bucket names from integration stack"
        echo "🔍 Sources bucket: $SOURCES_BUCKET"
        echo "🔍 Artifacts bucket: $ARTIFACTS_BUCKET"
        echo "🔧 Make sure BitbucketIntegrationV2Stack-$ENVIRONMENT is deployed"
        exit 1
    fi
    
    echo "🔍 Using the following configuration:"
    echo "   - Repository key: $REPOSITORY_KEY"
    echo "   - Pipeline name: $PIPELINE_NAME"
    echo "   - Stack name: $STACK_NAME"
    echo "   - Sources bucket: $SOURCES_BUCKET"
    echo "   - Artifacts bucket: $ARTIFACTS_BUCKET"
    echo "   - Environment: $ENVIRONMENT"
    echo ""
    
    # Create Bitbucket project and repository
    create_bitbucket_project || {
        echo "❌ Failed to create Bitbucket project"
        exit 1
    }
    
    create_bitbucket_repository || {
        echo "❌ Failed to create Bitbucket repository"
        exit 1
    }
    
    # Create initial content in repository
    create_initial_content || {
        echo "⚠️ Failed to create initial content - trying alternative method"
        create_initial_commit_via_api || {
            echo "❌ Failed to create initial content via API"
            echo "⚠️ E2E tests may fail due to empty repository"
        }
    }
    
    # Verify repository
    verify_repository || {
        echo "❌ Repository verification failed"
        exit 1
    }
    
    # Deploy test pipeline
    deploy_test_pipeline || {
        echo "❌ Failed to deploy test pipeline"
        exit 1
    }
    
    # Find actual stack name (may be different due to CDK naming)
    ACTUAL_STACK_NAME=$(find_actual_stack_name "$STACK_NAME")
    
    # Get webhook endpoint and secret
    WEBHOOK_ENDPOINT=$(get_webhook_endpoint)
    WEBHOOK_SECRET=$(get_webhook_secret)
    # echo "WEBHOOK_SECRET: $WEBHOOK_SECRET"
    
    # Configure webhook
    if [ -n "$WEBHOOK_SECRET" ]; then
        configure_webhook "$WEBHOOK_ENDPOINT" "$WEBHOOK_SECRET" || {
            echo "⚠️ Failed to configure webhook"
        }
    else
        echo "⚠️ Webhook secret not found - skipping webhook configuration"
    fi
    
    # Get DynamoDB table and insert mapping
    DYNAMODB_TABLE=$(get_dynamodb_table)
    if [ -n "$DYNAMODB_TABLE" ]; then
        insert_dynamodb_mapping "$DYNAMODB_TABLE" "$REPOSITORY_KEY" "$PIPELINE_NAME" || {
            echo "⚠️ Failed to insert mapping in DynamoDB"
        }
    else
        echo "⚠️ DynamoDB table not found - skipping mapping insertion"
    fi
    
    # Save credentials for E2E test
    save_credentials "$ACTUAL_STACK_NAME"
    
    # Return to original directory
    cd "$MY_DIR"
    
    echo ""
    echo "✅ E2E test setup completed successfully!"
    echo "📝 To run the E2E tests, use:"
    echo "   source /tmp/e2e-credentials.sh"
    echo "   npm test -- -t 'E2E'"
    echo ""
    echo "🧹 To clean up resources, use:"
    echo "   scripts/cleanup-e2e-test.sh"
    echo ""
}

# Execute main function
main "$@"
