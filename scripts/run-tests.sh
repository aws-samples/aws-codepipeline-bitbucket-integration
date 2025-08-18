#!/bin/bash

set -e

echo "🧪 Executando testes para AWS CodePipeline Bitbucket Integration"

# Cores para output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Função para executar comando com feedback
run_command() {
    local cmd="$1"
    local description="$2"
    
    echo -e "${YELLOW}▶ $description${NC}"
    if eval "$cmd"; then
        echo -e "${GREEN}✅ $description - Sucesso${NC}"
    else
        echo -e "${RED}❌ $description - Falhou${NC}"
        exit 1
    fi
    echo
}

# Verificar se Node.js está instalado
if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js não encontrado. Instale Node.js 20+ antes de continuar.${NC}"
    exit 1
fi

# Verificar versão do Node.js
NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
if [ "$NODE_VERSION" -lt 20 ]; then
    echo -e "${RED}❌ Node.js versão 20+ é necessária. Versão atual: $(node -v)${NC}"
    exit 1
fi

# Instalar dependências se necessário
if [ ! -d "node_modules" ]; then
    run_command "npm install" "Instalando dependências"
fi

# Executar linting
run_command "npm run lint" "Verificando qualidade do código (ESLint)"

# Executar testes unitários
run_command "npm run test:unit" "Executando testes unitários"

# Executar testes de integração (se LocalStack estiver disponível)
if command -v docker &> /dev/null && docker ps &> /dev/null; then
    echo -e "${YELLOW}🐳 Docker detectado - executando testes de integração${NC}"
    
    # Verificar se LocalStack está rodando
    if curl -s http://localhost:4566/_localstack/health &> /dev/null; then
        run_command "npm run test:integration" "Executando testes de integração com LocalStack"
    else
        echo -e "${YELLOW}⚠️  LocalStack não está rodando - pulando testes de integração${NC}"
        echo -e "${YELLOW}   Para executar testes de integração, inicie LocalStack:${NC}"
        echo -e "${YELLOW}   docker run --rm -it -p 4566:4566 localstack/localstack${NC}"
    fi
else
    echo -e "${YELLOW}⚠️  Docker não disponível - pulando testes de integração${NC}"
fi

# Executar testes de infraestrutura
run_command "npm run test:infrastructure" "Executando testes de infraestrutura CDK"

# Gerar relatório de cobertura
run_command "npm run test:coverage" "Gerando relatório de cobertura"

echo -e "${GREEN}🎉 All tests executed successfully!${NC}"
echo -e "${GREEN}📊 Coverage report available at: coverage/lcov-report/index.html${NC}"