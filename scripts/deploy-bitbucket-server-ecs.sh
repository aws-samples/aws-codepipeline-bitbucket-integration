#!/bin/bash

# Bitbucket Server 9.3.2 ECS - Test Environment Deployment Script
# This script automates the deployment of Bitbucket Server using ECS Fargate

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
BITBUCKET_VERSION="9.3.2"
SCRIPT_VERSION="1.0.0"

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
        1) AWS_DEFAULT_REGION="us-east-1";;
        3) AWS_DEFAULT_REGION="us-west-1";;
        4) AWS_DEFAULT_REGION="us-west-2";;
        5) AWS_DEFAULT_REGION="eu-west-1";;
        6) AWS_DEFAULT_REGION="ap-southeast-1";;
        7) 
            read -p "Enter custom region: " custom_region
            if [ -n "$custom_region" ]; then
                AWS_DEFAULT_REGION="$custom_region"
            else
                echo "Invalid region. Using default: us-east-2"
                AWS_DEFAULT_REGION="us-east-2"
            fi
            ;;
        2|""|"") AWS_DEFAULT_REGION="us-east-2";; # Default to us-east-2
        *) echo "Invalid selection. Using default: us-east-2"; AWS_DEFAULT_REGION="us-east-2";;
    esac
    
    echo -e "${GREEN}✅ Selected region: ${AWS_DEFAULT_REGION}${NC}"
    echo ""
}

# Global variables
PROJECT_ROOT=""
DEPLOYMENT_START_TIME=""
VERBOSE=false
AUTO_APPROVE=false
SKIP_VALIDATION=false
CLEANUP_AFTER=false
AWS_PROFILE=""

# Logging functions
log_info() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

log_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

log_debug() {
    if [ "$VERBOSE" = true ]; then
        echo -e "${PURPLE}[DEBUG]${NC} $1"
    fi
}

log_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Progress bar function
show_progress() {
    local duration=$1
    local message=$2
    local progress=0
    local bar_length=50
    
    echo -n "$message "
    while [ $progress -le $duration ]; do
        local filled=$((progress * bar_length / duration))
        local empty=$((bar_length - filled))
        
        printf "\r$message ["
        printf "%${filled}s" | tr ' ' '='
        printf "%${empty}s" | tr ' ' '-'
        printf "] %d%%" $((progress * 100 / duration))
        
        sleep 1
        ((progress++))
    done
    echo ""
}

# Display script header
show_header() {
    echo -e "${CYAN}"
    echo "╔══════════════════════════════════════════════════════════════════════════════╗"
    echo "║                    Bitbucket Server 9.3.2 ECS Deployment                   ║"
    echo "║                          Modern Container Architecture                        ║"
    echo "╠══════════════════════════════════════════════════════════════════════════════╣"
    echo "║ Version: $SCRIPT_VERSION                                                        ║"
    echo "║ Environment: $ENVIRONMENT                                                    ║"
    echo "║ Target: ECS Fargate + RDS PostgreSQL + EFS                                  ║"
    echo "║ Features: Auto Scaling, Zero Downtime, Cost Optimized                       ║"
    echo "╚══════════════════════════════════════════════════════════════════════════════╝"
    echo -e "${NC}"
}

# Show usage information
show_usage() {
    cat << EOF
Usage: $0 [OPTIONS]

Deploy Bitbucket Server 9.3.2 on AWS ECS Fargate

OPTIONS:
    --environment ENV       Environment (dev/staging/prod) [default: staging]
    --region REGION         AWS region (interactive selection if not provided)
    --profile PROFILE       AWS profile to use
    --skip-validation       Skip prerequisite validation
    --auto-approve         Auto approve CDK deployment
    --cleanup              Cleanup resources after testing
    --verbose              Verbose output
    --help                 Show this help message

EXAMPLES:
    $0                                    # Deploy with defaults
    $0 --region us-west-2                # Deploy to specific region
    $0 --auto-approve --verbose          # Auto approve with verbose output
    $0 --profile dev --cleanup           # Use specific profile and cleanup after

ARCHITECTURE:
    Internet → ALB → ECS Fargate → RDS PostgreSQL
                         ↓
                       EFS (Shared Storage)

FEATURES:
    ✅ Zero downtime deployments
    ✅ Auto scaling (CPU/Memory + Schedule)
    ✅ Cost optimization (34% vs EC2)
    ✅ Container security
    ✅ Managed database (RDS)
    ✅ Shared storage (EFS)

EOF
}

# Parse command line arguments
parse_arguments() {
    while [[ $# -gt 0 ]]; do
        case $1 in
            --environment|-e)
                ENVIRONMENT="$2"
                shift 2
                ;;
            --region)
                AWS_DEFAULT_REGION="$2"
                shift 2
                ;;
            --profile)
                AWS_PROFILE="$2"
                shift 2
                ;;
            --skip-validation)
                SKIP_VALIDATION=true
                shift
                ;;
            --auto-approve)
                AUTO_APPROVE=true
                shift
                ;;
            --cleanup)
                CLEANUP_AFTER=true
                shift
                ;;
            --verbose)
                VERBOSE=true
                shift
                ;;
            --help)
                show_usage
                exit 0
                ;;
            *)
                log_error "Unknown option: $1"
                show_usage
                exit 1
                ;;
        esac
    done
    
    # Select environment if not provided (default to staging)
    if [ -z "$ENVIRONMENT" ]; then
        select_environment
    fi
    
    # Select region if not provided
    if [ -z "$AWS_DEFAULT_REGION" ]; then
        select_region
    fi
    
    # Validate environment
    if [[ ! "$ENVIRONMENT" =~ ^(dev|staging|prod)$ ]]; then
        log_error "Invalid environment: $ENVIRONMENT. Must be dev, staging, or prod."
        exit 1
    fi
}

# Find project root directory
find_project_root() {
    local current_dir="$PWD"
    local max_depth=10
    local depth=0
    
    # If we are in the scripts directory, the root directory is one level up
    if [[ "$PWD" == */scripts ]]; then
        cd ".."
        echo "$PWD"
        return 0
    fi
    
    while [ $depth -lt $max_depth ]; do
        if [ -f "README.md" ] && [ -d "infra" ] && [ -d "app" ]; then
            if [ -d "infra/bitbucket-server-ecs" ] && [ -d "scripts" ]; then
                echo "$PWD"
                return 0
            fi
        fi
        
        cd ..
        ((depth++))
        
        if [ "$PWD" = "/" ]; then
            break
        fi
    done
    
    cd "$current_dir"
    return 1
}

# Setup working directory
setup_working_directory() {
    log_step "🔍 Detecting project root directory..."
    
    local original_dir="$PWD"
    
    if PROJECT_ROOT=$(find_project_root); then
        log_success "✅ Project found at: $PROJECT_ROOT"
        cd "$PROJECT_ROOT"
        export PROJECT_ROOT
        log_debug "Working directory configured: $PROJECT_ROOT"
    else
        log_error "❌ Could not find project root directory"
        log_info "Make sure you are running within the aws-codepipeline-bitbucket-integration project"
        log_info "Expected structure:"
        log_info "  ├── README.md"
        log_info "  ├── infra/bitbucket-server-ecs/"
        log_info "  ├── docs/runbooks/"
        log_info "  └── app/"
        exit 1
    fi
    
    # Verify ECS structure
    if [ ! -d "infra/bitbucket-server-ecs" ]; then
        log_error "❌ Directory infra/bitbucket-server-ecs not found"
        log_error "First run the ECS infrastructure creation"
        exit 1
    fi
    
    log_success "✅ ECS project structure validated"
}

# Check prerequisites
check_prerequisites() {
    if [ "$SKIP_VALIDATION" = true ]; then
        log_warning "⚠️  Skipping prerequisite validation"
        return 0
    fi
    
    log_step "🔍 Checking prerequisites..."
    
    local missing_tools=()
    
    # Check required tools
    local tools=("aws:AWS CLI" "node:Node.js" "npm:NPM" "cdk:AWS CDK" "curl:cURL")
    
    for tool_info in "${tools[@]}"; do
        IFS=':' read -r tool desc <<< "$tool_info"
        if ! command -v "$tool" &> /dev/null; then
            missing_tools+=("$desc ($tool)")
        else
            local version
            case $tool in
                aws) version=$(aws --version 2>&1 | cut -d' ' -f1) ;;
                node) version="v$(node --version | cut -d'v' -f2)" ;;
                npm) version="v$(npm --version)" ;;
                cdk) version=$(cdk --version 2>&1 | cut -d' ' -f1) ;;
                curl) version=$(curl --version 2>&1 | head -1 | cut -d' ' -f2) ;;
            esac
            log_debug "✅ $desc: $version"
        fi
    done
    
    if [ ${#missing_tools[@]} -gt 0 ]; then
        log_error "❌ Required tools not found:"
        for tool in "${missing_tools[@]}"; do
            log_error "   - $tool"
        done
        log_info "Install the necessary tools and run again"
        exit 1
    fi
    
    # Check Node.js version
    local node_version
    node_version=$(node --version | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$node_version" -lt 18 ]; then
        log_error "❌ Node.js 18+ is required (current: v$node_version)"
        exit 1
    fi
    
    # Check AWS credentials
    if [ -n "$AWS_PROFILE" ]; then
        export AWS_PROFILE
        log_debug "Usando AWS profile: $AWS_PROFILE"
    fi
    
    if ! aws sts get-caller-identity &> /dev/null; then
        log_error "❌ AWS credentials not configured or invalid"
        if [ -n "$AWS_PROFILE" ]; then
            log_error "Check profile: $AWS_PROFILE"
        fi
        exit 1
    fi
    
    log_success "✅ All prerequisites met"
}

# Setup environment variables
setup_environment() {
    log_step "🌍 Setting up environment variables..."
    
    # AWS_DEFAULT_REGION should be set by now from parameter or interactive selection
    if [ -z "$AWS_DEFAULT_REGION" ]; then
        log_error "❌ AWS region not specified"
        exit 1
    fi
    
    export AWS_DEFAULT_REGION
    export CDK_DEFAULT_REGION=$AWS_DEFAULT_REGION
    export CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text)
    
    DEPLOYMENT_START_TIME=$(date +%s)
    
    log_success "✅ Environment configured"
    log_info "🌍 AWS Region: $AWS_DEFAULT_REGION"
    log_info "🏢 AWS Account: $CDK_DEFAULT_ACCOUNT"
    log_info "🐳 Container: atlassian/bitbucket:$BITBUCKET_VERSION"
    
    if [ -n "$AWS_PROFILE" ]; then
        log_info "👤 AWS Profile: $AWS_PROFILE"
    fi
}

# Install dependencies
install_dependencies() {
    log_step "📦 Installing CDK dependencies..."
    
    cd "$PROJECT_ROOT/infra/bitbucket-server-ecs"
    
    if [ -f "package-lock.json" ]; then
        log_debug "Using npm ci for fast installation"
        npm ci --silent
    else
        log_debug "Using npm install"
        npm install --silent
    fi
    
    log_success "✅ Dependencies installed"
    cd - > /dev/null
}

# Bootstrap CDK environment
bootstrap_cdk_environment() {
    log_step "🚀 Preparing CDK environment..."
    
    cd "$PROJECT_ROOT/infra/bitbucket-server-ecs"
    
    # Check if already bootstrapped
    local bootstrap_stack_exists
    bootstrap_stack_exists=$(aws cloudformation describe-stacks \
        --stack-name "CDKToolkit" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].StackStatus' \
        --output text 2>/dev/null || echo "NOT_FOUND")
    
    if [ "$bootstrap_stack_exists" = "NOT_FOUND" ] || [ "$bootstrap_stack_exists" = "DELETE_COMPLETE" ]; then
        log_info "Running CDK bootstrap..."
        if ! cdk bootstrap "aws://$CDK_DEFAULT_ACCOUNT/$AWS_DEFAULT_REGION"; then
            log_error "❌ CDK bootstrap failed"
            exit 1
        fi
        log_success "✅ CDK bootstrap completed"
    else
        log_debug "CDK already bootstrapped (status: $bootstrap_stack_exists)"
    fi
    
    cd - > /dev/null
}

# Deploy ECS infrastructure
deploy_ecs_infrastructure() {
    log_step "🏗️  Deploying ECS infrastructure..."
    
    cd "$PROJECT_ROOT/infra/bitbucket-server-ecs"
    
    # Show what will be deployed
    log_info "Checking infrastructure changes..."
    if [ "$VERBOSE" = true ]; then
        cdk diff
    fi
    
    # Deploy with appropriate approval setting
    local deploy_cmd="cdk deploy"
    if [ "$AUTO_APPROVE" = true ]; then
        deploy_cmd="$deploy_cmd --require-approval never"
        log_debug "Auto-approval enabled"
    fi
    
    # Add environment context
    deploy_cmd="$deploy_cmd --context environment=$ENVIRONMENT"
    
    log_info "Starting ECS stack deployment..."
    log_warning "⏱️  Estimated time: 15-20 minutes"
    
    if ! $deploy_cmd; then
        log_error "❌ ECS infrastructure deployment failed"
        exit 1
    fi
    
    log_success "✅ ECS infrastructure deployed successfully"
    cd - > /dev/null
}

# Wait for ECS service to be stable
wait_for_ecs_service() {
    log_step "⏳ Waiting for ECS service to stabilize..."
    
    local cluster_name="BitbucketServerECS-${ENVIRONMENT}-Cluster"
    local service_name="BitbucketServerECS-${ENVIRONMENT}-Service"
    local max_attempts=40  # 20 minutes
    local attempt=1
    
    log_info "Monitoring service: $service_name"
    log_info "Cluster: $cluster_name"
    
    while [ $attempt -le $max_attempts ]; do
        log_info "Attempt $attempt/$max_attempts: Checking service status..."
        
        # Get service status
        local service_status
        service_status=$(aws ecs describe-services \
            --cluster "$cluster_name" \
            --services "$service_name" \
            --region "$AWS_DEFAULT_REGION" \
            --query 'services[0].status' \
            --output text 2>/dev/null || echo "NOT_FOUND")
        
        if [ "$service_status" = "ACTIVE" ]; then
            # Check if tasks are running
            local running_count
            running_count=$(aws ecs describe-services \
                --cluster "$cluster_name" \
                --services "$service_name" \
                --region "$AWS_DEFAULT_REGION" \
                --query 'services[0].runningCount' \
                --output text 2>/dev/null || echo "0")
            
            if [ "$running_count" -gt 0 ]; then
                log_success "✅ ECS service is active with $running_count task(s) running"
                return 0
            else
                log_debug "Service active but no tasks running yet"
            fi
        else
            log_debug "Service status: $service_status"
        fi
        
        sleep 30
        ((attempt++))
    done
    
    log_error "❌ ECS service did not stabilize in the expected time"
    log_info "Check the AWS ECS console for more details"
    exit 1
}

# Wait for Bitbucket to be ready
wait_for_bitbucket_ready() {
    log_step "🔄 Waiting for Bitbucket Server to initialize..."
    
    # Get ALB DNS name
    local alb_dns
    alb_dns=$(aws cloudformation describe-stacks \
        --stack-name "BitbucketServerEcsStack-${ENVIRONMENT}" \
        --region "$AWS_DEFAULT_REGION" \
        --query 'Stacks[0].Outputs[?contains(OutputKey, `ALB`) && contains(OutputKey, `DNS`)].OutputValue' \
        --output text 2>/dev/null)
    
    if [ -z "$alb_dns" ] || [ "$alb_dns" = "None" ]; then
        log_error "❌ Não foi possível obter DNS do Load Balancer"
        exit 1
    fi
    
    log_info "🌐 Load Balancer DNS: $alb_dns"
    log_info "⏱️  Estimated time: 2-3 minutes (container startup)"
    
    local max_attempts=20  # 10 minutes
    local attempt=1
    
    while [ $attempt -le $max_attempts ]; do
        log_info "Attempt $attempt/$max_attempts: Testing connectivity..."
        
        # Test health endpoint
        if curl -s -f "http://$alb_dns/status" > /dev/null 2>&1; then
            log_success "✅ Bitbucket Server está respondendo!"
            echo "$alb_dns" > /tmp/bitbucket-alb-dns.txt
            return 0
        elif curl -s -f "http://$alb_dns" > /dev/null 2>&1; then
            log_success "✅ Bitbucket Server está acessível!"
            echo "$alb_dns" > /tmp/bitbucket-alb-dns.txt
            return 0
        else
            log_debug "Waiting for Bitbucket to respond..."
        fi
        
        sleep 30
        ((attempt++))
    done
    
    log_error "❌ Bitbucket Server did not become accessible in the expected time"
    log_info "Check container logs in CloudWatch"
    exit 1
}

# Validate deployment
validate_deployment() {
    log_step "✅ Validating deployment..."
    
    local alb_dns
    alb_dns=$(cat /tmp/bitbucket-alb-dns.txt 2>/dev/null)
    
    if [ -z "$alb_dns" ]; then
        log_error "❌ DNS do ALB não encontrado"
        exit 1
    fi
    
    # Test various endpoints
    local tests=("/:Main page" "/status:Health check")
    local passed=0
    local total=${#tests[@]}
    
    for test_info in "${tests[@]}"; do
        IFS=':' read -r endpoint desc <<< "$test_info"
        
        if curl -s -f "http://$alb_dns$endpoint" > /dev/null 2>&1; then
            log_success "✅ $desc: OK"
            ((passed++))
        else
            log_warning "⚠️  $desc: FALHOU"
        fi
    done
    
    log_info "Tests passed: $passed/$total"
    
    if [ $passed -eq $total ]; then
        log_success "✅ Deployment validated successfully"
    else
        log_warning "⚠️  Some tests failed, but the service may still be functional"
    fi
}

# Show deployment information
show_deployment_info() {
    log_step "📋 Informações do Deployment"
    
    local alb_dns
    alb_dns=$(cat /tmp/bitbucket-alb-dns.txt 2>/dev/null)
    
    local deployment_time=$(($(date +%s) - DEPLOYMENT_START_TIME))
    local deployment_minutes=$((deployment_time / 60))
    
    echo ""
    echo -e "${CYAN}╔══════════════════════════════════════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║                           DEPLOYMENT COMPLETED                              ║${NC}"
    echo -e "${CYAN}╚══════════════════════════════════════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${GREEN}🎉 Bitbucket Server 9.3.2 deployed successfully!${NC}"
    echo ""
    echo -e "${BLUE}📊 DEPLOYMENT INFORMATION:${NC}"
    echo -e "   🕐 Total time: ${deployment_minutes} minutes"
    echo -e "   🌍 Region: $AWS_DEFAULT_REGION"
    echo -e "   🏢 Account: $CDK_DEFAULT_ACCOUNT"
    echo -e "   🐳 Version: $BITBUCKET_VERSION"
    echo ""
    echo -e "${BLUE}🌐 ACCESS:${NC}"
    echo -e "   🔗 URL: ${GREEN}http://$alb_dns${NC}"
    echo -e "   ⏱️  Status: Ready for initial configuration"
    echo ""
    echo -e "${BLUE}🏗️  DEPLOYED ARCHITECTURE:${NC}"
    echo -e "   ✅ ECS Fargate Cluster"
    echo -e "   ✅ Application Load Balancer"
    echo -e "   ✅ RDS PostgreSQL 14.9"
    echo -e "   ✅ EFS Shared Storage"
    echo -e "   ✅ Auto Scaling configurado"
    echo -e "   ✅ CloudWatch Logs"
    echo ""
    echo -e "${BLUE}💰 COST OPTIMIZATIONS:${NC}"
    echo -e "   ✅ Scale to Zero (weekends)"
    echo -e "   ✅ Right-sized resources"
    echo -e "   ✅ Single NAT Gateway"
    echo -e "   ✅ Estimated cost: ~\$100/month"
    echo ""
    echo -e "${BLUE}🔧 NEXT STEPS:${NC}"
    echo -e "   1. Access: ${GREEN}http://$alb_dns${NC}"
    echo -e "   2. Configure Bitbucket license"
    echo -e "   3. Create administrator user"
    echo -e "   4. Configure repositories"
    echo ""
    echo -e "${BLUE}📚 DOCUMENTAÇÃO:${NC}"
    echo -e "   📖 README: infra/bitbucket-server-ecs/README.md"
    echo -e "   🚀 Deploy Guide: infra/bitbucket-server-ecs/DEPLOYMENT_GUIDE.md"
    echo -e "   📊 Migration Analysis: docs/ECS_MIGRATION_ANALYSIS.md"
    echo ""
    
    # Save deployment summary
    cat > deployment-summary-ecs.txt << EOF
# Bitbucket Server 8.2.1 ECS - Deployment Summary

## Deployment Information
- Date: $(date)
- Region: $AWS_DEFAULT_REGION
- Account: $CDK_DEFAULT_ACCOUNT
- Deployment Time: ${deployment_minutes} minutes
- Version: $BITBUCKET_VERSION

## Access Information
- URL: http://$alb_dns
- Status: Ready for initial configuration

## Architecture Deployed
- ECS Fargate Cluster: BitbucketServerECS-Cluster
- ECS Service: BitbucketServerECS-Service
- Application Load Balancer: BitbucketServerECS-ALB
- RDS PostgreSQL: BitbucketServerECS-Database
- EFS File System: BitbucketServerECS-FileSystem
- Auto Scaling: CPU/Memory + Scheduled

## Cost Optimizations
- Scale to Zero: Weekends (Friday 6PM - Monday 8AM)
- Right-sized Resources: 4GB RAM / 2 vCPU
- Single NAT Gateway: Cost reduction
- Estimated Monthly Cost: ~\$100

## Monitoring
- CloudWatch Logs: /ecs/BitbucketServerECS
- Container Insights: Enabled
- Health Checks: Native ECS + ALB

## Next Steps
1. Access Bitbucket at: http://$alb_dns
2. Complete initial setup wizard
3. Configure license and admin user
4. Create repositories and configure integrations

## Troubleshooting
- ECS Service: AWS Console > ECS > Clusters > BitbucketServerECS-Cluster
- Logs: CloudWatch > Log Groups > /ecs/BitbucketServerECS
- Health: EC2 > Load Balancers > Target Groups

## Cleanup
To remove all resources: npx cdk destroy
EOF
    
    log_success "📄 Resumo salvo em: deployment-summary-ecs.txt"
}

# Cleanup resources if requested
cleanup_resources() {
    if [ "$CLEANUP_AFTER" = true ]; then
        log_step "🧹 Cleaning up resources (--cleanup enabled)..."
        
        echo -n "Are you sure you want to remove all resources? (y/N): "
        read -r confirm
        
        if [[ $confirm =~ ^[Yy]$ ]]; then
            cd "$PROJECT_ROOT/infra/bitbucket-server-ecs"
            
            log_warning "Removing ECS stack..."
            cdk destroy --force
            
            log_success "✅ Resources removed"
        else
            log_info "Cleanup cancelled"
        fi
    fi
}

# Cleanup temporary files
cleanup_temp_files() {
    rm -f /tmp/bitbucket-alb-dns.txt
}

# Main deployment function
main() {
    show_header
    
    parse_arguments "$@"
    setup_working_directory
    check_prerequisites
    setup_environment
    install_dependencies
    bootstrap_cdk_environment
    deploy_ecs_infrastructure
    wait_for_ecs_service
    wait_for_bitbucket_ready
    validate_deployment
    show_deployment_info
    cleanup_resources
    
    log_success "🎉 ECS deployment completed successfully!"
}

# Handle script interruption
cleanup_on_exit() {
    log_warning "Script interrompido. Limpando arquivos temporários..."
    cleanup_temp_files
}

trap cleanup_on_exit EXIT

# Run main function
main "$@"
