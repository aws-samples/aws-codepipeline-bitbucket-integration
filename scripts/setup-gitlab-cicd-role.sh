#!/bin/bash
set -e

# Script para configurar role IAM para GitLab CI/CD
ROLE_NAME="GitLabCICD"
ACCOUNT_ID="381492300081"
POLICY_FILE="infra/gitlab-aws-integration/lib/gitlab-cicd-role.json"

echo "🔧 Configurando role IAM para GitLab CI/CD..."

# Verificar se a role existe
if aws iam get-role --role-name "$ROLE_NAME" >/dev/null 2>&1; then
    echo "📝 Atualizando assume role policy existente..."
    aws iam update-assume-role-policy \
        --role-name "$ROLE_NAME" \
        --policy-document file://"$POLICY_FILE"
else
    echo "🆕 Criando nova role..."
    aws iam create-role \
        --role-name "$ROLE_NAME" \
        --assume-role-policy-document file://"$POLICY_FILE" \
        --description "Role para GitLab CI/CD access"
fi

# Anexar políticas necessárias
echo "🔗 Anexando políticas necessárias..."

# Política para CDK
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/PowerUserAccess" || true

# Política para IAM (necessária para CDK)
aws iam attach-role-policy \
    --role-name "$ROLE_NAME" \
    --policy-arn "arn:aws:iam::aws:policy/IAMFullAccess" || true

echo "✅ Role configurada com sucesso!"
echo "ARN: arn:aws:iam::${ACCOUNT_ID}:role/${ROLE_NAME}"