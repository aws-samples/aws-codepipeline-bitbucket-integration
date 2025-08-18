#!/bin/bash

set -e

echo "🔧 Configuring AWS environment for integration tests"

# Cores
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

# Configuração
TEST_REGION=${AWS_TEST_REGION:-us-east-1}
TEST_PROFILE=${AWS_TEST_PROFILE:-default}

echo -e "${BLUE}Configuration:${NC}"
echo "  Region: $TEST_REGION"
echo "  Profile: $TEST_PROFILE"
echo ""

# Verificar AWS CLI
if ! command -v aws &> /dev/null; then
    echo -e "${RED}❌ AWS CLI not found${NC}"
    exit 1
fi

# Verificar credenciais
echo -e "${YELLOW}🔍 Checking AWS credentials...${NC}"
if ! aws sts get-caller-identity --profile $TEST_PROFILE --region $TEST_REGION &> /dev/null; then
    echo -e "${RED}❌ Invalid or unconfigured AWS credentials${NC}"
    echo "Configure your credentials:"
    echo "  aws configure --profile $TEST_PROFILE"
    echo "  or"
    echo "  export AWS_ACCESS_KEY_ID=..."
    echo "  export AWS_SECRET_ACCESS_KEY=..."
    exit 1
fi

ACCOUNT_ID=$(aws sts get-caller-identity --profile $TEST_PROFILE --region $TEST_REGION --query Account --output text)
echo -e "${GREEN}✅ Valid credentials (Account: $ACCOUNT_ID)${NC}"

# Verificar permissões necessárias
echo -e "${YELLOW}🔍 Checking required permissions...${NC}"

check_permission() {
    local service=$1
    local action=$2
    local resource=$3
    
    echo -n "  Testing $service:$action... "
    
    case $service in
        "s3")
            case $action in
                "CreateBucket")
                    if aws s3api head-bucket --bucket "test-permission-check-$(date +%s)" --profile $TEST_PROFILE --region $TEST_REGION 2>/dev/null; then
                        echo -e "${GREEN}✅${NC}"
                    else
                        echo -e "${YELLOW}⚠️  (will be tested during execution)${NC}"
                    fi
                    ;;
            esac
            ;;
        "sqs")
            case $action in
                "CreateQueue")
                    echo -e "${YELLOW}⚠️  (will be tested during execution)${NC}"
                    ;;
            esac
            ;;
        "secretsmanager")
            case $action in
                "CreateSecret")
                    echo -e "${YELLOW}⚠️  (will be tested during execution)${NC}"
                    ;;
            esac
            ;;
        "cloudwatch")
            case $action in
                "PutMetricData")
                    echo -e "${YELLOW}⚠️  (will be tested during execution)${NC}"
                    ;;
            esac
            ;;
    esac
}

check_permission "s3" "CreateBucket"
check_permission "sqs" "CreateQueue"
check_permission "secretsmanager" "CreateSecret"
check_permission "cloudwatch" "PutMetricData"

# Configurar variáveis de ambiente
echo -e "${YELLOW}🌍 Configuring environment variables...${NC}"

export AWS_TEST_REGION=$TEST_REGION
export AWS_PROFILE=$TEST_PROFILE

# Criar arquivo de configuração para testes
cat > .env.test << EOF
# Configuração para testes de integração AWS
AWS_TEST_REGION=$TEST_REGION
AWS_PROFILE=$TEST_PROFILE
AWS_ACCOUNT_ID=$ACCOUNT_ID

# Configurações de teste
NODE_ENV=test
LOG_LEVEL=error
EOF

echo -e "${GREEN}✅ .env.test file created${NC}"

# Instruções
echo ""
echo -e "${BLUE}📋 Next steps:${NC}"
echo ""
echo "1. Run integration tests:"
echo -e "   ${GREEN}npm run test:integration${NC}"
echo ""
echo "2. Or run specific tests:"
echo -e "   ${GREEN}npm test tests/integration/aws-services/real-aws.test.js${NC}"
echo -e "   ${GREEN}npm test tests/integration/end-to-end/real-webhook-flow.test.js${NC}"
echo ""
echo "3. Monitore custos AWS durante os testes:"
echo -e "   ${YELLOW}⚠️  Os testes criam recursos temporários que são limpos automaticamente${NC}"
echo -e "   ${YELLOW}⚠️  Custo estimado: < $0.01 por execução${NC}"
echo ""
echo -e "${BLUE}🔧 CI/CD Configuration:${NC}"
echo "Para usar em pipelines, configure as variáveis:"
echo "  AWS_ACCESS_KEY_ID"
echo "  AWS_SECRET_ACCESS_KEY"
echo "  AWS_TEST_REGION"
echo ""
echo -e "${GREEN}🎉 Environment configured successfully!${NC}"