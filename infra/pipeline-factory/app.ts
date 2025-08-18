#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { PipelineFactoryStack } from './lib/pipeline-factory-stack';

const app = new cdk.App();

const pipelineName = app.node.tryGetContext('pipelineName') || process.env.CDK_PIPELINE_NAME;
const repositoryKey = app.node.tryGetContext('repositoryKey') || process.env.CDK_REPOSITORY_KEY;
const branch = app.node.tryGetContext('branch') || process.env.CDK_BRANCH || 'main';
const sourceBucket = app.node.tryGetContext('sourceBucket') || process.env.CDK_SOURCE_BUCKET;
const artifactsBucket = app.node.tryGetContext('artifactsBucket') || process.env.CDK_ARTIFACTS_BUCKET;
const environment = app.node.tryGetContext('environment') || process.env.CDK_ENVIRONMENT || 'dev';

// Log the region being used for debugging
const deployRegion = process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1';
console.log(`🌍 Pipeline-factory deploying to region: ${deployRegion}`);

// Validate that we're not mixing regions
if (process.env.AWS_REGION && process.env.CDK_DEFAULT_REGION && 
    process.env.AWS_REGION !== process.env.CDK_DEFAULT_REGION) {
  console.warn(`⚠️ Region mismatch detected:`);
  console.warn(`   AWS_REGION: ${process.env.AWS_REGION}`);
  console.warn(`   CDK_DEFAULT_REGION: ${process.env.CDK_DEFAULT_REGION}`);
  console.warn(`   Using AWS_REGION: ${process.env.AWS_REGION}`);
}

// Verificar se é um comando que precisa dos parâmetros (deploy, synth)
const isDeployCommand = process.argv.includes('deploy') || process.argv.includes('synth');
const isDiffCommand = process.argv.includes('diff');

if (isDeployCommand && (!pipelineName || !repositoryKey || !sourceBucket || !artifactsBucket)) {
  console.error('❌ Missing required context parameters for deployment:');
  console.error('  - pipelineName:', pipelineName ? '✅' : '❌');
  console.error('  - repositoryKey:', repositoryKey ? '✅' : '❌');
  console.error('  - sourceBucket:', sourceBucket ? '✅' : '❌');
  console.error('  - artifactsBucket:', artifactsBucket ? '✅' : '❌');
  throw new Error('Required context: pipelineName, repositoryKey, sourceBucket, artifactsBucket');
}

// Para diff, usar valores padrão se não fornecidos
if (isDiffCommand) {
  const defaultPipelineName = pipelineName || 'default-pipeline';
  const defaultRepositoryKey = repositoryKey || 'DEFAULT/default-repo';
  const defaultSourceBucket = sourceBucket || 'default-bucket';
  const defaultArtifactsBucket = artifactsBucket || 'default-artifacts-bucket';
  
  console.log('🔍 Running diff with values:', {
    pipelineName: defaultPipelineName,
    repositoryKey: defaultRepositoryKey,
    sourceBucket: defaultSourceBucket,
    artifactsBucket: defaultArtifactsBucket
  });
}

// Usar valores padrão para diff se necessário
const finalPipelineName = pipelineName || 'default-pipeline';
const finalRepositoryKey = repositoryKey || 'DEFAULT/default-repo';
const finalSourceBucket = sourceBucket || 'default-bucket';
const finalArtifactsBucket = artifactsBucket || 'default-artifacts-bucket';

// Função para simplificar nomes
const simplifyName = (name: string): string => {
  // Remover caracteres não alfanuméricos
  return name.replace(/[^a-zA-Z0-9]/g, '');
};

// Extrair componentes do repositoryKey
const [projectName, repoName] = finalRepositoryKey.split('/');

// Simplificar os nomes
const simplifiedProject = simplifyName(projectName || 'default');
const simplifiedRepo = simplifyName(repoName || 'repo');

// Criar os nomes com o prefixo solicitado (com primeira letra maiúscula)
const projectWithPrefix = `Proj${simplifiedProject}`;
const repoWithPrefix = `Repo${simplifiedRepo}`;

// Nome da stack no formato solicitado
const stackName = `Pipeline-${projectWithPrefix}-${repoWithPrefix}`;

new PipelineFactoryStack(app, stackName, {
  pipelineName: finalPipelineName,
  repositoryKey: finalRepositoryKey,
  branch,
  sourceBucket: finalSourceBucket,
  artifactsBucket: finalArtifactsBucket,
  environment,
  projectWithPrefix,
  repoWithPrefix,
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.AWS_REGION || process.env.CDK_DEFAULT_REGION || 'us-east-1',
  },
});
