#!/bin/bash

# Script para configurar a integração GitLab-AWS

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
GITLAB_GROUP="lexlab"
GITLAB_PROJECT="aws-codepipeline-bitbucket-integration"
ACCOUNT_ID=""

# Parse command line arguments
while [[ $# -gt 0 ]]; do
    case $1 in
        --region|-r)
            REGION="$2"
            shift 2
            ;;
        --profile|-p)
            PROFILE="$2"
            shift 2
            ;;
        --gitlab-group|-g)
            GITLAB_GROUP="$2"
            shift 2
            ;;
        --gitlab-project|-j)
            GITLAB_PROJECT="$2"
            shift 2
            ;;
        --account|-a)
            ACCOUNT_ID="$2"
            shift 2
            ;;
        --help|-h)
            echo "Usage: $0 [OPTIONS]"
            echo "Options:"
            echo "  --region, -r         AWS region"
            echo "  --profile, -p        AWS profile [default: default]"
            echo "  --gitlab-group, -g   GitLab group name [default: lexlab]"
            echo "  --gitlab-project, -j GitLab project name [default: aws-codepipeline-bitbucket-integration]"
            echo "  --account, -a        AWS account ID"
            echo "  --help, -h           Show this help"
            exit 0
            ;;
        *)
            echo "Unknown option: $1"
            exit 1
            ;;
    esac
done

# Validate inputs
if [ -z "$ACCOUNT_ID" ]; then
    read -p "Enter your AWS account ID: " ACCOUNT_ID
fi

if [ -z "$REGION" ]; then
    read -p "Enter your AWS region: " REGION
fi

echo -e "${BLUE}🚀 GitLab AWS Integration Setup${NC}"
echo -e "${BLUE}===============================${NC}"
echo -e "${BLUE}Account ID: ${ACCOUNT_ID}${NC}"
echo -e "${BLUE}Region: ${REGION}${NC}"
echo -e "${BLUE}Profile: ${PROFILE}${NC}"
echo -e "${BLUE}GitLab Group: ${GITLAB_GROUP}${NC}"
echo -e "${BLUE}GitLab Project: ${GITLAB_PROJECT}${NC}"
echo ""

# Navigate to integration directory
echo -e "${BLUE}📂 Navigating to integration directory...${NC}"
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" &> /dev/null && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." &> /dev/null && pwd )"
cd "$PROJECT_ROOT/infra/gitlab-aws-integration"

# Install dependencies
echo -e "${BLUE}📦 Installing dependencies...${NC}"
npm install
echo -e "${GREEN}✅ Dependencies installed${NC}"

# Deploy the stack
echo -e "${BLUE}🚀 Deploying GitLab AWS Integration Stack...${NC}"
npx cdk deploy \
    --require-approval never \
    --profile $PROFILE \
    --context account=$ACCOUNT_ID \
    --context region=$REGION \
    --context gitlabGroup=$GITLAB_GROUP \
    --context gitlabProject=$GITLAB_PROJECT

if [ $? -eq 0 ]; then
    echo -e "${GREEN}✅ GitLab AWS Integration setup completed successfully!${NC}"
    
    # Get the role ARN
    ROLE_ARN=$(aws cloudformation describe-stacks \
        --stack-name GitlabAwsIntegrationStack \
        --query "Stacks[0].Outputs[?OutputKey=='GitLabRoleArn'].OutputValue" \
        --output text \
        --region $REGION \
        --profile $PROFILE)
    
    # Atualizar o arquivo .gitlab-ci.yml com os valores reais
    echo -e "${BLUE}📝 Atualizando o arquivo .gitlab-ci.yml...${NC}"
    GITLAB_CI_FILE="$PROJECT_ROOT/.gitlab-ci.yml"

    if [ -f "$GITLAB_CI_FILE" ]; then
        # Fazer backup do arquivo original
        cp "$GITLAB_CI_FILE" "${GITLAB_CI_FILE}.bak"
        
        # Detectar o sistema operacional para compatibilidade com sed
        if [[ "$OSTYPE" == "darwin"* ]]; then
            # macOS
            sed -i '' "s|AWS_CREDS_TARGET_ROLE: \"arn:aws:iam::\${AWS_ACCOUNT_ID}:role/GitLabCICD\"|AWS_CREDS_TARGET_ROLE: \"$ROLE_ARN\"|g" "$GITLAB_CI_FILE"
            sed -i '' "s|\${AWS_REGION}|$REGION|g" "$GITLAB_CI_FILE"
            sed -i '' "s|\${AWS_ACCOUNT_ID}|$ACCOUNT_ID|g" "$GITLAB_CI_FILE"
        else
            # Linux e outros
            sed -i "s|AWS_CREDS_TARGET_ROLE: \"arn:aws:iam::\${AWS_ACCOUNT_ID}:role/GitLabCICD\"|AWS_CREDS_TARGET_ROLE: \"$ROLE_ARN\"|g" "$GITLAB_CI_FILE"
            sed -i "s|\${AWS_REGION}|$REGION|g" "$GITLAB_CI_FILE"
            sed -i "s|\${AWS_ACCOUNT_ID}|$ACCOUNT_ID|g" "$GITLAB_CI_FILE"
        fi
        
        echo -e "${GREEN}✅ Arquivo .gitlab-ci.yml atualizado com sucesso!${NC}"
        echo -e "${BLUE}   Backup salvo como ${GITLAB_CI_FILE}.bak${NC}"
        
        echo -e "${YELLOW}📝 Próximos Passos:${NC}"
        echo "=============="
        echo ""
        echo "1. 🚀 Faça commit e push do arquivo .gitlab-ci.yml para iniciar o pipeline:"
        echo "   git add .gitlab-ci.yml"
        echo "   git commit -m \"Configurar GitLab CI/CD para AWS\""
        echo "   git push"
        echo ""
    else
        echo -e "${YELLOW}⚠️  Arquivo .gitlab-ci.yml não encontrado. Não foi possível atualizar automaticamente.${NC}"
        echo -e "${YELLOW}📝 Próximos Passos:${NC}"
        echo "=============="
        echo ""
        echo "1. 🔧 Configure o arquivo .gitlab-ci.yml com o seguinte valor para AWS_CREDS_TARGET_ROLE:"
        echo "   AWS_CREDS_TARGET_ROLE: \"$ROLE_ARN\""
        echo "   AWS_DEFAULT_REGION: \"$REGION\""
        echo ""
        echo "2. 🚀 Faça commit e push do arquivo .gitlab-ci.yml para iniciar o pipeline"
        echo ""
    fi
else
    echo -e "${RED}❌ GitLab AWS Integration setup failed!${NC}"
    exit 1
fi
