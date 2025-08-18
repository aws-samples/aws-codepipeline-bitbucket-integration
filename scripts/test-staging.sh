#!/bin/bash
set -e

echo "🧪 Running integrated tests in staging environment"

# Configurar ambiente
export TEST_ENVIRONMENT=staging
export AWS_DEFAULT_REGION=${AWS_DEFAULT_REGION:-us-east-1}

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Verificar se stacks existem
echo "🔍 Checking staging resources..."

BITBUCKET_STACK=$(aws cloudformation describe-stacks \
  --stack-name BitbucketServerEcsStack-staging \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

INTEGRATION_STACK=$(aws cloudformation describe-stacks \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].StackStatus' \
  --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$BITBUCKET_STACK" = "NOT_FOUND" ]; then
    echo "❌ BitbucketServerEcsStack-staging stack not found"
    echo "Execute: ./scripts/deploy-bitbucket-server-ecs.sh --environment staging"
    exit 1
fi

if [ "$INTEGRATION_STACK" = "NOT_FOUND" ]; then
    echo "❌ BitbucketIntegrationV2Stack-staging stack not found"
    echo "Execute: ./scripts/deploy-bitbucket-integration-v2.sh --environment staging"
    exit 1
fi

# Obter recursos do staging
BITBUCKET_URL=$(aws cloudformation describe-stacks \
  --stack-name BitbucketServerEcsStack-staging \
  --query 'Stacks[0].Outputs[?contains(OutputKey, `ALB`)].OutputValue' \
  --output text)

WEBHOOK_ENDPOINT=$(aws cloudformation describe-stacks \
  --stack-name BitbucketIntegrationV2Stack-staging \
  --query 'Stacks[0].Outputs[?OutputKey==`WebhookEndpoint`].OutputValue' \
  --output text)

echo "🌐 Bitbucket URL: http://$BITBUCKET_URL"
echo "🔗 Webhook Endpoint: $WEBHOOK_ENDPOINT"

# Executar apenas testes AWS reais (pular LocalStack)
echo "🧪 Running AWS integration tests..."
NODE_ENV=staging \
TEST_ENVIRONMENT=staging \
BITBUCKET_URL=http://$BITBUCKET_URL \
WEBHOOK_ENDPOINT=$WEBHOOK_ENDPOINT \
AWS_TEST_REGION=${AWS_DEFAULT_REGION} \
CDK_DEFAULT_ACCOUNT=$(aws sts get-caller-identity --query Account --output text) \
npm run test:integration:aws

echo "✅ Staging tests completed!"