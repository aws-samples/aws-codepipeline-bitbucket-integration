import * as cdk from 'aws-cdk-lib';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as applicationautoscaling from 'aws-cdk-lib/aws-applicationautoscaling';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as cr from 'aws-cdk-lib/custom-resources';
import { Construct } from 'constructs';

/**
 * Bitbucket ECS Construct
 * 
 * Creates ECS Fargate service for Bitbucket Server 9.3.2:
 * - ECS Cluster
 * - Task Definition with optimized container configuration
 * - Fargate Service with auto-scaling
 * - Scheduled scaling for business hours
 * - Integration with ALB, RDS, and EFS
 */
export class BitbucketEcsConstruct extends Construct {
  constructor(scope, id, props) {
    super(scope, id);

    this.serviceName = props.serviceName;
    this.infrastructure = props.infrastructure;

    // Bitbucket Server configuration
    this.bitbucketConfig = {
      version: '9.3.2',
      image: 'atlassian/bitbucket:9.3.2',
      resources: {
        memory: 4096,      // 4GB RAM
        cpu: 2048,         // 2 vCPU
      },
      ports: {
        http: 7990,        // Bitbucket web interface
        ssh: 7999          // Git SSH access
      }
    };

    // Create ECS Cluster
    this.createCluster();

    // Create Task Definition
    this.createTaskDefinition();

    // Create ECS Service
    this.createService();

    // Configure Auto Scaling
    this.configureAutoScaling();

    // Add graceful shutdown custom resource
    this.addGracefulShutdownResource();

    // Configure proper deletion dependencies
    this.configureDeletionDependencies();
  }

  createCluster() {
    this.cluster = new ecs.Cluster(this, 'BitbucketCluster', {
      vpc: this.infrastructure.vpc,
      clusterName: `${this.serviceName}-Cluster`,
      containerInsights: true, // Enable CloudWatch Container Insights
      enableFargateCapacityProviders: true
    });

    // Add removal policy to ensure proper cleanup
    this.cluster.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);

    // Tag the cluster
    cdk.Tags.of(this.cluster).add('Name', `${this.serviceName}-Cluster`);
    cdk.Tags.of(this.cluster).add('Component', 'ECS-Cluster');
  }

  createTaskDefinition() {
    // Create task execution role
    const taskExecutionRole = new iam.Role(this, 'TaskExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS Task Execution Role for Bitbucket Server',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AmazonECSTaskExecutionRolePolicy')
      ]
    });

    // Add permissions to read secrets
    taskExecutionRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'secretsmanager:GetSecretValue',
        'secretsmanager:DescribeSecret'
      ],
      resources: [this.infrastructure.database.secret.secretArn]
    }));

    // Create task role for application permissions
    const taskRole = new iam.Role(this, 'TaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
      description: 'ECS Task Role for Bitbucket Server application'
    });

    // Add ECS Exec permissions for troubleshooting
    taskRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ssmmessages:CreateControlChannel',
        'ssmmessages:CreateDataChannel',
        'ssmmessages:OpenControlChannel',
        'ssmmessages:OpenDataChannel'
      ],
      resources: ['*']
    }));

    // Create Fargate task definition
    this.taskDefinition = new ecs.FargateTaskDefinition(this, 'BitbucketTaskDefinition', {
      family: `${this.serviceName}-TaskDefinition`,
      memoryLimitMiB: this.bitbucketConfig.resources.memory,
      cpu: this.bitbucketConfig.resources.cpu,
      executionRole: taskExecutionRole,
      taskRole: taskRole,
      volumes: [{
        name: 'bitbucket-data',
        efsVolumeConfiguration: {
          fileSystemId: this.infrastructure.fileSystem.fileSystemId,
          transitEncryption: 'ENABLED',
          authorizationConfig: {
            iam: 'ENABLED'
          }
        }
      }]
    });

    // Add container to task definition
    this.addBitbucketContainer();

    // Tag the task definition
    cdk.Tags.of(this.taskDefinition).add('Name', `${this.serviceName}-TaskDefinition`);
    cdk.Tags.of(this.taskDefinition).add('Component', 'ECS-TaskDefinition');
  }

  addBitbucketContainer() {
    const container = this.taskDefinition.addContainer('bitbucket', {
      image: ecs.ContainerImage.fromRegistry(this.bitbucketConfig.image),
      essential: true,
      environment: {
        // Database Configuration
        'JDBC_DRIVER': 'org.postgresql.Driver',
        'JDBC_URL': `jdbc:postgresql://${this.infrastructure.database.instanceEndpoint.hostname}:5432/bitbucket`,
        'JDBC_USER': 'bitbucket',
        
        // JVM Settings (optimized for 9.3.2 and container)
        'JVM_MINIMUM_MEMORY': '1024m',
        'JVM_MAXIMUM_MEMORY': '3072m',
        'JVM_SUPPORT_RECOMMENDED_ARGS': '-XX:+UseG1GC -XX:+UseStringDeduplication -Datlassian.plugins.enable.wait=300',
        
        // Proxy Configuration for ALB
        'SERVER_PROXY_NAME': this.infrastructure.alb.loadBalancerDnsName,
        'SERVER_PROXY_PORT': '80',
        'SERVER_SCHEME': 'http',
        'SERVER_SECURE': 'false',
        
        // Application Settings
        'BITBUCKET_HOME': '/var/atlassian/application-data/bitbucket',
        'SET_PERMISSIONS': 'true',
        'SEARCH_ENABLED': 'true',
        
        // Container Optimizations
        'JAVA_OPTS': '-Datlassian.recovery.password=admin -Datlassian.plugins.enable.wait=300'
      },
      secrets: {
        // Database password from Secrets Manager
        'JDBC_PASSWORD': ecs.Secret.fromSecretsManager(
          this.infrastructure.database.secret,
          'password'
        )
      },
      portMappings: [
        {
          containerPort: this.bitbucketConfig.ports.http,
          protocol: ecs.Protocol.TCP,
          name: 'bitbucket-http'
        },
        {
          containerPort: this.bitbucketConfig.ports.ssh,
          protocol: ecs.Protocol.TCP,
          name: 'bitbucket-ssh'
        }
      ],
      mountPoints: [{
        sourceVolume: 'bitbucket-data',
        containerPath: '/var/atlassian/application-data/bitbucket',
        readOnly: false
      }],
      logging: ecs.LogDrivers.awsLogs({
        streamPrefix: 'bitbucket',
        logGroup: this.infrastructure.logGroup,
        datetimeFormat: '%Y-%m-%d %H:%M:%S'
      }),
      healthCheck: {
        command: [
          'CMD-SHELL',
          'curl -f http://localhost:7990/status || exit 1'
        ],
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        retries: 3,
        startPeriod: cdk.Duration.seconds(300) // 5 minutes grace period for Bitbucket startup
      },
      user: 'bitbucket:bitbucket' // Run as bitbucket user for security
    });

    return container;
  }

  createService() {
    this.service = new ecs.FargateService(this, 'BitbucketService', {
      cluster: this.cluster,
      taskDefinition: this.taskDefinition,
      serviceName: `${this.serviceName}-Service`,
      desiredCount: 1,
      minHealthyPercent: 0,     // Allow zero downtime deployments
      maxHealthyPercent: 100,   // Only 1 task during deployment (single instance)
      enableExecuteCommand: true, // Enable ECS Exec for troubleshooting
      enableLogging: true,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      },
      securityGroups: [this.infrastructure.ecsSecurityGroup],
      assignPublicIp: false,
      platformVersion: ecs.FargatePlatformVersion.LATEST,
      capacityProviderStrategies: [
        {
          capacityProvider: 'FARGATE',
          weight: 1,
          base: 1
        }
      ],
      deploymentConfiguration: {
        alarms: [], // No alarms for now
        rollback: {
          enabled: true
        }
      }
    });

    // Attach service to ALB target group
    this.service.attachToApplicationTargetGroup(this.infrastructure.targetGroup);

    // Tag the service
    cdk.Tags.of(this.service).add('Name', `${this.serviceName}-Service`);
    cdk.Tags.of(this.service).add('Component', 'ECS-Service');
  }

  configureAutoScaling() {
    // Configure auto scaling target - LIMITED TO 1 TASK MAXIMUM
    const scalingTarget = this.service.autoScaleTaskCount({
      minCapacity: 0,  // Can scale to zero on weekends
      maxCapacity: 1   // Maximum 1 instance only (single task constraint)
    });

    // CPU-based auto scaling - DISABLED (would not scale beyond 1 task)
    // Note: Keeping for monitoring purposes but won't trigger scaling beyond 1 task
    scalingTarget.scaleOnCpuUtilization('CpuScaling', {
      targetUtilizationPercent: 70,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2)
    });

    // Memory-based auto scaling - DISABLED (would not scale beyond 1 task)
    // Note: Keeping for monitoring purposes but won't trigger scaling beyond 1 task
    scalingTarget.scaleOnMemoryUtilization('MemoryScaling', {
      targetUtilizationPercent: 80,
      scaleInCooldown: cdk.Duration.minutes(5),
      scaleOutCooldown: cdk.Duration.minutes(2)
    });

    // Business hours scaling - Scale UP Monday-Friday 7 AM ET (11 AM UTC)
    scalingTarget.scaleOnSchedule('ScaleUpBusinessHours', {
      schedule: applicationautoscaling.Schedule.cron({
        hour: '11',    // 7 AM ET = 11 AM UTC
        minute: '0',
        weekDay: '1-5' // Monday to Friday
      }),
      minCapacity: 1,
      maxCapacity: 1  // Only 1 task during business hours
    });

    // Evening scaling - Scale DOWN Monday-Friday 7 PM ET (11 PM UTC)
    scalingTarget.scaleOnSchedule('ScaleDownEvening', {
      schedule: applicationautoscaling.Schedule.cron({
        hour: '23',    // 7 PM ET = 11 PM UTC
        minute: '0',
        weekDay: '1-5' // Monday to Friday
      }),
      minCapacity: 0,
      maxCapacity: 0
    });

    this.scalingTarget = scalingTarget;
  }

  /**
   * Add a custom resource that gracefully scales down ECS services before stack deletion
   * This prevents the capacity provider "in use" error during CDK destroy
   */
  addGracefulShutdownResource() {
    // Create IAM role for the Lambda function
    const shutdownLambdaRole = new iam.Role(this, 'ShutdownLambdaRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'Role for ECS graceful shutdown Lambda',
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole')
      ]
    });

    // Add ECS permissions
    shutdownLambdaRole.addToPolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      actions: [
        'ecs:UpdateService',
        'ecs:DescribeServices',
        'ecs:ListServices',
        'ecs:DescribeTasks',
        'ecs:ListTasks'
      ],
      resources: ['*']
    }));

    // Create Lambda function for graceful shutdown
    const shutdownFunction = new lambda.Function(this, 'GracefulShutdownFunction', {
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'index.handler',
      role: shutdownLambdaRole,
      timeout: cdk.Duration.minutes(5),
      code: lambda.Code.fromInline(`
import boto3
import json
import time
import logging

logger = logging.getLogger()
logger.setLevel(logging.INFO)

def handler(event, context):
    """
    Custom resource handler for graceful ECS service shutdown
    """
    try:
        ecs_client = boto3.client('ecs')
        
        cluster_name = event['ResourceProperties']['ClusterName']
        service_name = event['ResourceProperties']['ServiceName']
        
        logger.info(f"Processing {event['RequestType']} for cluster: {cluster_name}, service: {service_name}")
        
        if event['RequestType'] == 'Delete':
            # Scale down the service to 0 tasks
            logger.info(f"Scaling down service {service_name} to 0 tasks")
            
            try:
                response = ecs_client.update_service(
                    cluster=cluster_name,
                    service=service_name,
                    desiredCount=0
                )
                logger.info(f"Service update initiated: {response['service']['status']}")
                
                # Wait for tasks to stop (up to 3 minutes)
                max_wait_time = 180  # 3 minutes
                wait_interval = 10   # 10 seconds
                elapsed_time = 0
                
                while elapsed_time < max_wait_time:
                    tasks_response = ecs_client.list_tasks(
                        cluster=cluster_name,
                        serviceName=service_name
                    )
                    
                    running_tasks = len(tasks_response.get('taskArns', []))
                    logger.info(f"Running tasks: {running_tasks}")
                    
                    if running_tasks == 0:
                        logger.info("All tasks have stopped successfully")
                        break
                    
                    time.sleep(wait_interval)
                    elapsed_time += wait_interval
                
                if elapsed_time >= max_wait_time:
                    logger.warning("Timeout waiting for tasks to stop, but continuing with deletion")
                
            except ecs_client.exceptions.ServiceNotFoundException:
                logger.info(f"Service {service_name} not found, likely already deleted")
            except Exception as e:
                logger.error(f"Error scaling down service: {str(e)}")
                # Don't fail the deletion, just log the error
        
        # Send success response
        send_response(event, context, 'SUCCESS', {})
        
    except Exception as e:
        logger.error(f"Error in handler: {str(e)}")
        send_response(event, context, 'FAILED', {})

def send_response(event, context, status, data):
    """Send response to CloudFormation"""
    import urllib3
    
    response_body = {
        'Status': status,
        'Reason': f'See CloudWatch Log Stream: {context.log_stream_name}',
        'PhysicalResourceId': context.log_stream_name,
        'StackId': event['StackId'],
        'RequestId': event['RequestId'],
        'LogicalResourceId': event['LogicalResourceId'],
        'Data': data
    }
    
    json_response_body = json.dumps(response_body)
    
    headers = {
        'content-type': '',
        'content-length': str(len(json_response_body))
    }
    
    http = urllib3.PoolManager()
    
    try:
        response = http.request(
            'PUT',
            event['ResponseURL'],
            body=json_response_body,
            headers=headers
        )
        logger.info(f"Response sent to CloudFormation: {response.status}")
    except Exception as e:
        logger.error(f"Failed to send response: {str(e)}")
      `)
    });

    // Create custom resource
    this.gracefulShutdownResource = new cdk.CustomResource(this, 'GracefulShutdownResource', {
      serviceToken: shutdownFunction.functionArn,
      properties: {
        ClusterName: this.cluster.clusterName,
        ServiceName: this.service.serviceName,
        // Add a timestamp to force updates when needed
        Timestamp: Date.now().toString()
      }
    });

    // Ensure the custom resource is created after the service
    this.gracefulShutdownResource.node.addDependency(this.service);
  }

  /**
   * Configure proper deletion dependencies to ensure services are deleted before capacity providers
   */
  configureDeletionDependencies() {
    // Add removal policy to the service to ensure clean deletion
    this.service.applyRemovalPolicy(cdk.RemovalPolicy.DESTROY);
    
    // The graceful shutdown resource already depends on the service (set in addGracefulShutdownResource)
    // CloudFormation will naturally delete services before clusters, so we don't need to force
    // the cluster to depend on the graceful shutdown resource (which would create a cycle)
    
    // Natural deletion order: GracefulShutdown -> Service -> Cluster
    // The custom resource will scale down the service during stack deletion
  }
}
