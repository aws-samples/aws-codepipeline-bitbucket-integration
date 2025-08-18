#!/bin/bash

set -e

# Parâmetros padrão
ENVIRONMENT="staging"
PROJECT=""
REPO=""
SOURCES_BUCKET=""
ARTIFACTS_BUCKET=""

# Parse argumentos
while [[ $# -gt 0 ]]; do
  case $1 in
    --environment)
      ENVIRONMENT="$2"
      shift 2
      ;;
    --project)
      PROJECT="$2"
      shift 2
      ;;
    --repo)
      REPO="$2"
      shift 2
      ;;
    --sources-bucket)
      SOURCES_BUCKET="$2"
      shift 2
      ;;
    --artifacts-bucket)
      ARTIFACTS_BUCKET="$2"
      shift 2
      ;;
    *)
      echo "Argumento desconhecido: $1"
      exit 1
      ;;
  esac
done

# Validar parâmetros obrigatórios
if [ -z "$PROJECT" ] || [ -z "$REPO" ] || [ -z "$SOURCES_BUCKET" ] || [ -z "$ARTIFACTS_BUCKET" ]; then
    echo "❌ Required parameters: --project, --repo, --sources-bucket, --artifacts-bucket"
    exit 1
fi

AWS_REGION=${AWS_DEFAULT_REGION:-us-east-1}
PIPELINE_NAME="e2e-test-pipeline-$ENVIRONMENT"
REPOSITORY_KEY="$PROJECT/$REPO"

echo "🚀 E2E Test Pipeline Deployment"
echo "================================="
echo "  - Pipeline: $PIPELINE_NAME"
echo "  - Repository Key: $REPOSITORY_KEY"
echo "  - Sources Bucket: $SOURCES_BUCKET"
echo "  - Artifacts Bucket: $ARTIFACTS_BUCKET"

# Navegar para diretório do pipeline factory
SCRIPT_DIR="$(dirname "$0")"
ROOT_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT_DIR/infra/pipeline-factory"

# Verificar se stack já existe
STACK_NAME="BitbucketPipeline-$(echo $REPOSITORY_KEY | sed 's/\//-/g')"
STACK_STATUS=$(aws cloudformation describe-stacks --region $AWS_REGION --stack-name $STACK_NAME --query 'Stacks[0].StackStatus' --output text 2>/dev/null || echo "NOT_FOUND")

if [ "$STACK_STATUS" != "NOT_FOUND" ]; then
    echo "✅ Pipeline stack already exists ($STACK_STATUS)"
    exit 0
fi

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    echo "📦 Installing dependencies..."
    npm install
fi

# Build TypeScript
echo "🔨 Compiling TypeScript..."
npm run build

# Deploy do stack
echo "🚀 Deploying pipeline..."
npx cdk deploy \
  --context pipelineName=$PIPELINE_NAME \
  --context repositoryKey=$REPOSITORY_KEY \
  --context branch=main \
  --context sourceBucket=$SOURCES_BUCKET \
  --context artifactsBucket=$ARTIFACTS_BUCKET \
  --context environment=$ENVIRONMENT \
  --require-approval never

echo "✅ Test pipeline deployed successfully!"