import { Stack } from 'aws-cdk-lib';
import * as ssm from 'aws-cdk-lib/aws-ssm';
import { Construct } from 'constructs';
import { BitbucketInfrastructure } from './bitbucket-infrastructure.js';
import { BitbucketEcsConstruct } from './bitbucket-ecs-construct.js';

/**
 * Bitbucket Server 9.3.2 ECS Stack
 * 
 * This stack creates a containerized Bitbucket Server deployment using:
 * - AWS ECS Fargate for container orchestration
 * - RDS PostgreSQL for database
 * - EFS for shared file storage
 * - Application Load Balancer for traffic distribution
 * - Auto Scaling for business hours optimization
 */
export class BitbucketEcsStack extends Stack {
  constructor(scope, id, props) {
    super(scope, id, props);
    
    const envName = props.envName || 'dev';

    // Create shared infrastructure (RDS, EFS, ALB, VPC, Security Groups)
    const infrastructure = new BitbucketInfrastructure(this, 'BitbucketInfrastructure', {
      serviceName: `BitbucketServerECS-${envName}`
    });

    // Create ECS service and task definition
    const ecsService = new BitbucketEcsConstruct(this, 'BitbucketEcsService', {
      serviceName: `BitbucketServerECS-${envName}`,
      infrastructure: infrastructure
    });

    // Export important values for reference
    this.exportValue(infrastructure.alb.loadBalancerDnsName, {
      name: `BitbucketServerECS-${envName}-ALB-DNS`,
      description: `Application Load Balancer DNS name for Bitbucket Server (${envName})`
    });

    this.exportValue(infrastructure.database.instanceEndpoint.hostname, {
      name: `BitbucketServerECS-${envName}-DB-Endpoint`,
      description: `RDS PostgreSQL database endpoint (${envName})`
    });

    this.exportValue(infrastructure.fileSystem.fileSystemId, {
      name: `BitbucketServerECS-${envName}-EFS-ID`,
      description: `EFS file system ID for shared storage (${envName})`
    });

    this.exportValue(ecsService.cluster.clusterName, {
      name: `BitbucketServerECS-${envName}-Cluster-Name`,
      description: `ECS cluster name (${envName})`
    });

    this.exportValue(ecsService.service.serviceName, {
      name: `BitbucketServerECS-${envName}-Service-Name`,
      description: `ECS service name (${envName})`
    });

    // Store ALB URL in SSM Parameter Store
    new ssm.StringParameter(this, 'BitbucketAlbUrl', {
      parameterName: `/bitbucket-server-ecs/${envName}/alb-url`,
      description: `Application Load Balancer URL for Bitbucket Server (${envName})`,
      stringValue: infrastructure.alb.loadBalancerDnsName,
      tier: ssm.ParameterTier.STANDARD
    });
  }
}
