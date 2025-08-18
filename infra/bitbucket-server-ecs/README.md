# Bitbucket Server 9.3.2 on AWS ECS Fargate

Este projeto implementa uma solução containerizada do Bitbucket Server 9.3.2 usando AWS ECS Fargate, oferecendo uma alternativa moderna e eficiente à implementação tradicional em EC2.

## 🏗️ Arquitetura

### Componentes Principais

- **ECS Fargate**: Orquestração de containers serverless
- **RDS PostgreSQL 14**: Banco de dados gerenciado
- **EFS**: Sistema de arquivos compartilhado para dados persistentes
- **Application Load Balancer**: Distribuição de tráfego
- **Auto Scaling**: Escalabilidade automática baseada em métricas e horários

### Diagrama de Arquitetura

```
Internet → ALB → ECS Fargate → RDS PostgreSQL
                     ↓
                   EFS (Shared Storage)
```

## 🚀 Vantagens sobre EC2

| Aspecto | EC2 | ECS Fargate |
|---------|-----|-------------|
| **Startup Time** | 15+ minutos | 2-3 minutos |
| **Recursos** | 8GB RAM fixo | 4GB RAM otimizado |
| **Custo/mês** | ~$50-70 | ~$30-40 |
| **Manutenção** | Alta (patches OS) | Baixa (managed) |
| **Scaling** | Manual/Scheduled | Auto/Dynamic |
| **Deployment** | Script complexo | Container image |
| **Rollback** | Difícil | Instantâneo |

## 📋 Pré-requisitos

- AWS CLI configurado
- Node.js 18+
- AWS CDK 2.87.0+
- Permissões AWS adequadas

## 🛠️ Instalação

1. **Clone e navegue para o diretório:**
   ```bash
   cd infra/bitbucket-server-ecs
   ```

2. **Instale as dependências:**
   ```bash
   npm install
   ```

3. **Configure as variáveis de ambiente:**
   ```bash
   export CDK_DEFAULT_ACCOUNT=123456789012
   export CDK_DEFAULT_REGION=us-east-1
   ```

4. **Bootstrap CDK (primeira vez apenas):**
   ```bash
   npx cdk bootstrap
   ```

## 🚀 Deploy

### Deploy Completo
```bash
npx cdk deploy
```

### Verificar mudanças antes do deploy
```bash
npx cdk diff
```

### Sintetizar template CloudFormation
```bash
npx cdk synth
```

## 🔧 Configuração

### Bitbucket Server 9.3.2

- **Imagem Docker**: `atlassian/bitbucket:9.3.2`
- **Recursos**: 4GB RAM / 2 vCPU
- **Portas**: 7990 (HTTP), 7999 (SSH)
- **Health Check**: `/status` endpoint

### Database (RDS PostgreSQL)

- **Engine**: PostgreSQL 14.9
- **Instance**: t3.micro
- **Storage**: 20GB (auto-scaling até 100GB)
- **Backup**: 7 dias de retenção

### Auto Scaling

#### Métricas
- **CPU**: Scale out em 70%, scale in em 5 minutos
- **Memory**: Scale out em 80%, scale in em 5 minutos

#### Horários (UTC)
- **Scale UP**: Segunda-feira 8:00 (1-2 instâncias)
- **Scale DOWN**: Sexta-feira 18:00 (0 instâncias)

## 🔍 Monitoramento

### CloudWatch Logs
```bash
aws logs describe-log-groups --log-group-name-prefix "/ecs/BitbucketServerECS"
```

### ECS Service Status
```bash
aws ecs describe-services --cluster BitbucketServerECS-Cluster --services BitbucketServerECS-Service
```

### Container Insights
Habilitado automaticamente no cluster ECS para métricas detalhadas.

## 🛠️ Troubleshooting

### ECS Exec (Acesso ao Container)
```bash
aws ecs execute-command \
  --cluster BitbucketServerECS-Cluster \
  --task <task-id> \
  --container bitbucket \
  --interactive \
  --command "/bin/bash"
```

### Logs em Tempo Real
```bash
aws logs tail /ecs/BitbucketServerECS --follow
```

### Health Check Manual
```bash
curl -f http://<alb-dns-name>/status
```

## 🔐 Segurança

### Security Groups
- **ALB**: Permite HTTP/HTTPS (80/443) de qualquer lugar
- **ECS**: Permite tráfego apenas do ALB (7990/7999)
- **RDS**: Permite PostgreSQL apenas do ECS (5432)
- **EFS**: Permite NFS apenas do ECS (2049)

### IAM Roles
- **Task Execution Role**: Acesso a Secrets Manager e ECR
- **Task Role**: Permissões da aplicação + ECS Exec

### Secrets Management
- Senha do banco armazenada no AWS Secrets Manager
- Rotação automática disponível

## 💰 Otimizações de Custo

1. **Fargate vs EC2**: ~40% redução de custo
2. **Single NAT Gateway**: Reduz custos de rede
3. **EFS Lifecycle**: Move arquivos antigos para IA após 30 dias
4. **RDS t3.micro**: Instância otimizada para desenvolvimento
5. **Scale to Zero**: Desliga nos weekends
6. **Log Retention**: 1 semana apenas

## 🔄 Operações

### Atualizar Versão do Bitbucket
1. Edite `bitbucket-ecs-construct.js`:
   ```javascript
   version: '8.3.0',
   image: 'atlassian/bitbucket:8.3.0',
   ```
2. Deploy: `npx cdk deploy`

### Backup Manual
```bash
# Database
aws rds create-db-snapshot \
  --db-instance-identifier <db-id> \
  --db-snapshot-identifier bitbucket-manual-$(date +%Y%m%d)

# EFS (via AWS Backup ou snapshot)
```

### Rollback
```bash
# ECS automaticamente faz rollback em caso de falha
# Para rollback manual:
aws ecs update-service \
  --cluster BitbucketServerECS-Cluster \
  --service BitbucketServerECS-Service \
  --task-definition <previous-task-definition-arn>
```

## 📊 Métricas Importantes

### ECS Service
- **CPU Utilization**: < 70%
- **Memory Utilization**: < 80%
- **Task Count**: 1-2 (business hours)

### RDS
- **CPU Utilization**: < 80%
- **Database Connections**: < 80
- **Free Storage Space**: > 2GB

### ALB
- **Target Response Time**: < 2s
- **Healthy Host Count**: >= 1
- **HTTP 5XX Errors**: < 1%

## 🆘 Suporte

### Logs Importantes
```bash
# Application logs
aws logs filter-log-events --log-group-name "/ecs/BitbucketServerECS"

# ECS Agent logs
aws logs filter-log-events --log-group-name "/aws/ecs/containerinsights/BitbucketServerECS-Cluster/performance"
```

### Comandos Úteis
```bash
# Status do serviço
aws ecs describe-services --cluster BitbucketServerECS-Cluster --services BitbucketServerECS-Service

# Tasks em execução
aws ecs list-tasks --cluster BitbucketServerECS-Cluster --service-name BitbucketServerECS-Service

# Eventos do serviço
aws ecs describe-services --cluster BitbucketServerECS-Cluster --services BitbucketServerECS-Service --query 'services[0].events'
```

## 🧹 Cleanup

### Destruir Stack
```bash
npx cdk destroy
```

**⚠️ Atenção**: Isso removerá todos os recursos, incluindo dados no RDS e EFS.

### Backup Antes da Destruição
```bash
# Criar snapshot do RDS
aws rds create-db-snapshot --db-instance-identifier <db-id> --db-snapshot-identifier final-backup

# Backup EFS (manual via console ou AWS Backup)
```

## 📚 Referências

- [Atlassian Bitbucket Docker](https://hub.docker.com/r/atlassian/bitbucket)
- [AWS ECS Fargate](https://docs.aws.amazon.com/AmazonECS/latest/developerguide/AWS_Fargate.html)
- [AWS CDK Documentation](https://docs.aws.amazon.com/cdk/)
- [Bitbucket Server Documentation](https://confluence.atlassian.com/bitbucketserver/)

---

**Versão**: 1.0.0  
**Bitbucket Server**: 9.3.2  
**AWS CDK**: 2.87.0  
**Última Atualização**: Janeiro 2025
