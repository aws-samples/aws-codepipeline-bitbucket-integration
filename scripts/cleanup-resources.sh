#!/bin/bash

# Cleanup Resources Script for Bitbucket Integration V2
# This script removes all AWS resources created by the deployment scripts

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

# Utility functions (defined early so they can be used throughout the script)
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
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --environment, -e    Environment (dev/staging/prod)"
            echo "  --region, -r         AWS region (auto-detected if not specified)"
            echo "  --profile, -p        AWS profile [default: default]"
            echo "  --help, -h           Show this help"
            echo ""
            echo "If no environment is specified, you will be prompted to select one."
            echo "If no region is specified, the default AWS CLI region will be detected and confirmed."
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Function to detect and confirm AWS region
detect_and_confirm_region() {
    if [ -n "$REGION" ]; then
        echo -e "${GREEN}🌍 Region specified via parameter: ${REGION}${NC}"
    else
        # Try to detect region from AWS CLI configuration
        local detected_region
        detected_region=$(aws configure get region --profile "$PROFILE" 2>/dev/null || echo "")
        
        if [ -n "$detected_region" ]; then
            echo -e "${BLUE}🌍 AWS region detected: ${detected_region}${NC}"
            echo -n "Use this region for cleanup? (y/N): "
            read -r response
            if [[ "$response" =~ ^[yY]$ ]]; then
                REGION="$detected_region"
            else
                echo -n "Enter the desired AWS region: "
                read -r REGION
            fi
        else
            echo -e "${YELLOW}⚠️  No AWS region configuration detected${NC}"
            echo -n "Enter AWS region for cleanup: "
            read -r REGION
        fi
    fi
    
    # Validate region
    if [ -z "$REGION" ]; then
        print_error "AWS region is required"
        echo "Use: $0 --region <aws-region> or configure AWS CLI with 'aws configure'"
        exit 1
    fi
    
    # Test if region is valid and accessible
    echo -e "${BLUE}🔍 Validating region ${REGION}...${NC}"
    if ! aws ec2 describe-regions --region "$REGION" --profile "$PROFILE" --query 'Regions[?RegionName==`'$REGION'`]' --output text >/dev/null 2>&1; then
        print_error "Invalid or inaccessible region: $REGION"
        echo "Please verify that:"
        echo "  - The region exists (e.g., us-east-1, us-west-2, eu-west-1)"
        echo "  - Your AWS credentials are configured"
        echo "  - You have permissions to access the region"
        exit 1
    fi
    
    echo -e "${GREEN}✅ Region confirmed: ${REGION}${NC}"
    echo ""
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
    
    echo -e "${GREEN}✅ Selected environment: ${ENVIRONMENT}${NC}"
    echo ""
}

echo -e "${BLUE}🧹 Bitbucket Integration V2 - Resource Cleanup${NC}"
echo -e "${BLUE}===============================================${NC}"
echo ""

# Detect and confirm AWS region
detect_and_confirm_region

# Select environment if not provided
if [ -z "$ENVIRONMENT" ]; then
    select_environment
else
    # Validate provided environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        print_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
        exit 1
    fi
    echo -e "${GREEN}✅ Using environment: ${ENVIRONMENT}${NC}"
    echo ""
fi

echo -e "${BLUE}Configuration:${NC}"
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

# Check AWS credentials
print_info "Checking AWS credentials..."
if ! aws sts get-caller-identity --profile "$PROFILE" --region "$REGION" >/dev/null 2>&1; then
    print_error "AWS credentials are invalid or expired. Please refresh your credentials:"
    print_error "  aws configure"
    print_error "  or: aws sso login --profile $PROFILE"
    exit 1
fi
print_status "AWS credentials valid"

echo ""

# Get script directory and navigate to project root
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"

# Function to check if stack exists
stack_exists() {
    local stack_name=$1
    aws cloudformation describe-stacks \
        --stack-name "$stack_name" \
        --region "$REGION" \
        --profile "$PROFILE" \
        >/dev/null 2>&1
}

# Function to destroy CDK stack
destroy_cdk_stack() {
    local stack_name=$1
    local stack_dir=$2
    
    print_info "Checking stack: $stack_name"
    
    if stack_exists "$stack_name"; then
        print_warning "Found stack: $stack_name"
        echo ""
        echo -e "${YELLOW}⚠️  About to destroy: $stack_name${NC}"
        echo "This action cannot be undone!"
        echo -n "Do you want to destroy this stack? (y/N): "
        read -r confirm
        
        if [[ $confirm =~ ^[Yy]$ ]]; then
            print_info "Destroying stack: $stack_name"
            
            if [ -d "$PROJECT_ROOT/$stack_dir" ]; then
                cd "$PROJECT_ROOT/$stack_dir"
                
                # Export AWS_REGION for CDK to use the correct region
                export AWS_REGION="$REGION"
                
                # Use different context key based on stack type
                local context_param
                local bitbucket_url_param=""
                if [[ "$stack_name" == *"BitbucketServerEcs"* ]]; then
                    context_param="environment=$ENVIRONMENT"
                else
                    context_param="deployEnv=$ENVIRONMENT"
                    # Add dummy Bitbucket server URL for BitbucketIntegrationV2Stack
                    bitbucket_url_param="--context bitbucketServerUrl=http://dummy-bitbucket-server.local"
                fi
                
                if [ -n "$bitbucket_url_param" ]; then
                    npx cdk destroy "$stack_name" --force --profile "$PROFILE" --region "$REGION" --context "$context_param" --context "bitbucketServerUrl=http://dummy-bitbucket-server.local"
                else
                    npx cdk destroy "$stack_name" --force --profile "$PROFILE" --region "$REGION" --context "$context_param"
                fi
                
                if [ $? -eq 0 ]; then
                    print_info "CDK destroy command completed, checking stack status..."
                    
                    # Wait a moment for the operation to register
                    sleep 5
                    
                    # Check stack status and handle retries for ECS dependency issues
                    local retry_count=0
                    local max_retries=3
                    local stack_status
                    
                    while [ $retry_count -lt $max_retries ]; do
                        stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
                        
                        print_info "Stack status (attempt $((retry_count + 1))): $stack_status"
                        
                        if [ "$stack_status" = "NOT_FOUND" ]; then
                            print_status "Stack successfully deleted: $stack_name"
                            break
                        elif [[ "$stack_status" == "DELETE_COMPLETE" ]]; then
                            print_status "Stack successfully deleted: $stack_name"
                            break
                        elif [[ "$stack_status" == "DELETE_IN_PROGRESS" ]]; then
                            print_info "Stack deletion in progress, waiting..."
                            if aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" 2>/dev/null; then
                                print_status "Stack successfully deleted: $stack_name"
                                break
                            else
                                print_warning "Stack deletion failed or timed out"
                                stack_status=$(aws cloudformation describe-stacks --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")
                            fi
                        elif [[ "$stack_status" == "CREATE_COMPLETE" ]] || [[ "$stack_status" == "UPDATE_COMPLETE" ]] || [[ "$stack_status" == "UPDATE_ROLLBACK_COMPLETE" ]]; then
                            print_error "CDK destroy failed silently - stack still exists with status: $stack_status"
                            print_warning "This usually indicates a region mismatch or CDK context issue"
                            print_info "Attempting direct CloudFormation deletion..."
                            
                            # Try direct CloudFormation deletion as fallback
                            if aws cloudformation delete-stack --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" 2>/dev/null; then
                                print_info "Direct CloudFormation deletion initiated, waiting for completion..."
                                if aws cloudformation wait stack-delete-complete --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" 2>/dev/null; then
                                    print_status "Stack successfully deleted via direct CloudFormation: $stack_name"
                                    break
                                else
                                    print_error "Direct CloudFormation deletion also failed"
                                    break
                                fi
                            else
                                print_error "Direct CloudFormation deletion failed to initiate"
                                break
                            fi
                        elif [[ "$stack_status" == "DELETE_FAILED" ]]; then
                            print_warning "Stack deletion failed, checking for ECS dependency issues..."
                            
                            # Check for ECS capacity provider errors
                            local stack_events
                            stack_events=$(aws cloudformation describe-stack-events --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" --query 'StackEvents[?ResourceStatus==`DELETE_FAILED`].ResourceStatusReason' --output text 2>/dev/null || echo "")
                            
                            if echo "$stack_events" | grep -q "capacity provider.*in use"; then
                                print_info "ECS capacity provider dependency issue detected. Retrying in 30 seconds..."
                                sleep 30
                                
                                print_info "Retrying stack deletion (attempt $((retry_count + 2))/$max_retries)..."
                                if [ -n "$bitbucket_url_param" ]; then
                                    npx cdk destroy "$stack_name" --force --profile "$PROFILE" --context "$context_param" --context "bitbucketServerUrl=http://dummy-bitbucket-server.local" >/dev/null 2>&1
                                else
                                    npx cdk destroy "$stack_name" --force --profile "$PROFILE" --context "$context_param" >/dev/null 2>&1
                                fi
                                
                                ((retry_count++))
                            else
                                print_warning "Stack deletion failed with non-retryable error"
                                echo -n "Do you want to force delete the stack (this will abandon failed resources)? (y/N): "
                                read -r force_delete
                                
                                if [[ $force_delete =~ ^[Yy]$ ]]; then
                                    print_info "Force deleting stack..."
                                    if aws cloudformation delete-stack --stack-name "$stack_name" --region "$REGION" --profile "$PROFILE" 2>/dev/null; then
                                        print_warning "Stack force deletion initiated. Some resources may remain orphaned."
                                        print_info "Check AWS Console to manually clean up any remaining resources."
                                        break
                                    else
                                        print_error "Force deletion also failed"
                                        break
                                    fi
                                else
                                    print_info "Skipping force deletion. Stack remains in DELETE_FAILED state."
                                    break
                                fi
                            fi
                        else
                            print_warning "Unexpected stack status: $stack_status"
                            break
                        fi
                    done
                    
                    if [ $retry_count -eq $max_retries ]; then
                        print_error "Stack deletion failed after $max_retries attempts"
                        print_info "You may need to manually resolve ECS dependencies and retry"
                        return 1
                    fi
                else
                    print_error "CDK destroy command failed: $stack_name"
                    return 1
                fi
            else
                print_error "Directory not found: $PROJECT_ROOT/$stack_dir"
                return 1
            fi
        else
            print_info "Skipped stack: $stack_name"
        fi
        echo ""
    else
        print_info "Stack not found: $stack_name"
    fi
}

# Function to clean S3 buckets
clean_s3_buckets() {
    print_info "Checking for S3 buckets to clean..."
    
    # Find buckets with bitbucket integration prefix
    local buckets
    buckets=$(aws s3api list-buckets \
        --profile "$PROFILE" \
        --query 'Buckets[?contains(Name, \`bitbucket\`) || contains(Name, \`codepipeline\`)].Name' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$buckets" ]; then
        echo "Found S3 buckets:"
        for bucket in $buckets; do
            echo "  - $bucket"
        done
        
        echo -n "Do you want to empty and delete these buckets? (y/N): "
        read -r confirm
        
        if [[ $confirm =~ ^[Yy]$ ]]; then
            for bucket in $buckets; do
                print_info "Emptying bucket: $bucket"
                aws s3 rm "s3://$bucket" --recursive --profile "$PROFILE" 2>/dev/null || true
                
                print_info "Deleting bucket: $bucket"
                aws s3api delete-bucket --bucket "$bucket" --profile "$PROFILE" 2>/dev/null || true
                print_status "Bucket cleaned: $bucket"
            done
        fi
    else
        print_info "No S3 buckets found"
    fi
}

# Function to clean CloudWatch logs
clean_cloudwatch_logs() {
    print_info "Checking for CloudWatch log groups..."
    
    local log_groups
    log_groups=$(aws logs describe-log-groups \
        --region "$REGION" \
        --profile "$PROFILE" \
        --query 'logGroups[?contains(logGroupName, `bitbucket`) || contains(logGroupName, `BitbucketIntegration`)].logGroupName' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$log_groups" ]; then
        echo "Found CloudWatch log groups:"
        for log_group in $log_groups; do
            echo "  - $log_group"
        done
        
        echo -n "Do you want to delete these log groups? (y/N): "
        read -r confirm
        
        if [[ $confirm =~ ^[Yy]$ ]]; then
            for log_group in $log_groups; do
                print_info "Deleting log group: $log_group"
                aws logs delete-log-group \
                    --log-group-name "$log_group" \
                    --region "$REGION" \
                    --profile "$PROFILE" 2>/dev/null || true
                print_status "Log group deleted: $log_group"
            done
        fi
    else
        print_info "No CloudWatch log groups found"
    fi
}

# Function to clean Secrets Manager secrets
clean_secrets() {
    print_info "Checking for Secrets Manager secrets..."
    
    local secrets
    secrets=$(aws secretsmanager list-secrets \
        --region "$REGION" \
        --profile "$PROFILE" \
        --query 'SecretList[?contains(Name, `bitbucket-integration`)].Name' \
        --output text 2>/dev/null || echo "")
    
    if [ -n "$secrets" ]; then
        echo "Found secrets:"
        for secret in $secrets; do
            echo "  - $secret"
        done
        
        echo -n "Do you want to delete these secrets? (y/N): "
        read -r confirm
        
        if [[ $confirm =~ ^[Yy]$ ]]; then
            for secret in $secrets; do
                print_info "Deleting secret: $secret"
                aws secretsmanager delete-secret \
                    --secret-id "$secret" \
                    --force-delete-without-recovery \
                    --region "$REGION" \
                    --profile "$PROFILE" 2>/dev/null || true
                print_status "Secret deleted: $secret"
            done
        fi
    else
        print_info "No secrets found"
    fi
}

# Main cleanup process
echo -e "${BLUE}🗑️  Starting Resource Cleanup${NC}"
echo "================================="
echo ""

print_warning "This will permanently delete AWS resources!"
print_warning "Make sure you have backups of any important data."
echo ""
echo -n "Are you sure you want to continue? (y/N): "
read -r final_confirm

if [[ ! $final_confirm =~ ^[Yy]$ ]]; then
    print_info "Cleanup cancelled"
    exit 0
fi

echo ""

# Destroy CDK stacks
echo -e "${BLUE}🗂️  CDK Stack Cleanup${NC}"
echo "====================="
echo ""

print_info "Found the following stacks to potentially destroy:"
echo "1. BitbucketIntegrationV2Stack-${ENVIRONMENT} - Main integration infrastructure"
echo "2. BitbucketServerEcsStack-${ENVIRONMENT} - Test Bitbucket Server environment"
echo ""

destroy_cdk_stack "BitbucketIntegrationV2Stack-${ENVIRONMENT}" "infra/bitbucket-integration-v2"
destroy_cdk_stack "BitbucketServerEcsStack-${ENVIRONMENT}" "infra/bitbucket-server-ecs"

echo ""

# Clean additional resources
clean_s3_buckets
echo ""
clean_cloudwatch_logs
echo ""
clean_secrets

echo ""
echo -e "${GREEN}🎉 Cleanup Summary${NC}"
echo "=================="
echo ""
print_status "Resource cleanup completed!"
print_info "Some resources may take a few minutes to be fully removed"
print_info "Check AWS Console to verify all resources are deleted"

echo ""
echo -e "${BLUE}📝 Manual Cleanup (if needed)${NC}"
echo "============================="
echo ""
echo "If any resources remain, manually check:"
echo "• CloudFormation stacks"
echo "• S3 buckets"
echo "• Lambda functions"
echo "• API Gateway"
echo "• CloudWatch log groups"
echo "• Secrets Manager secrets"
echo "• ECS clusters and services"
echo "• RDS instances"
echo "• EFS file systems"

echo ""
print_status "Cleanup script completed!"
