import * as cdk from 'aws-cdk-lib';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as rds from 'aws-cdk-lib/aws-rds';
import * as efs from 'aws-cdk-lib/aws-efs';
import * as elbv2 from 'aws-cdk-lib/aws-elasticloadbalancingv2';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';

/**
 * Bitbucket Infrastructure Construct
 * 
 * Creates shared infrastructure components:
 * - VPC with public/private subnets
 * - RDS PostgreSQL database
 * - EFS file system for shared storage
 * - Application Load Balancer
 * - Security Groups
 * - CloudWatch Log Groups
 */
export class BitbucketInfrastructure extends Construct {
  constructor(scope, id, props) {
    super(scope, id);

    this.serviceName = props.serviceName;

    // Create VPC with public and private subnets
    this.vpc = new ec2.Vpc(this, 'BitbucketVPC', {
      maxAzs: 2,
      natGateways: 1, // Cost optimization - single NAT Gateway
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: 'Public',
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: 'Private',
          subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS,
        }
      ],
      enableDnsHostnames: true,
      enableDnsSupport: true
    });

    // Create Security Groups
    this.createSecurityGroups();

    // Create RDS PostgreSQL Database
    this.createDatabase();

    // Create EFS File System
    this.createFileSystem();

    // Create Application Load Balancer
    this.createLoadBalancer();

    // Create CloudWatch Log Group
    this.createLogGroup();
  }

  createSecurityGroups() {
    // ALB Security Group
    this.albSecurityGroup = new ec2.SecurityGroup(this, 'ALBSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Bitbucket Application Load Balancer',
      allowAllOutbound: true
    });

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(80),
      'Allow HTTP traffic from anywhere'
    );

    this.albSecurityGroup.addIngressRule(
      ec2.Peer.anyIpv4(),
      ec2.Port.tcp(443),
      'Allow HTTPS traffic from anywhere'
    );

    // ECS Security Group
    this.ecsSecurityGroup = new ec2.SecurityGroup(this, 'ECSSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Bitbucket ECS tasks',
      allowAllOutbound: true
    });

    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(7990),
      'Allow HTTP traffic from ALB to Bitbucket'
    );

    this.ecsSecurityGroup.addIngressRule(
      this.albSecurityGroup,
      ec2.Port.tcp(7999),
      'Allow SSH traffic from ALB to Bitbucket Git'
    );

    // Database Security Group
    this.dbSecurityGroup = new ec2.SecurityGroup(this, 'DatabaseSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Bitbucket RDS database',
      allowAllOutbound: false
    });

    this.dbSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(5432),
      'Allow PostgreSQL access from ECS tasks'
    );

    // EFS Security Group
    this.efsSecurityGroup = new ec2.SecurityGroup(this, 'EFSSecurityGroup', {
      vpc: this.vpc,
      description: 'Security group for Bitbucket EFS file system',
      allowAllOutbound: false
    });

    this.efsSecurityGroup.addIngressRule(
      this.ecsSecurityGroup,
      ec2.Port.tcp(2049),
      'Allow NFS access from ECS tasks'
    );
  }

  createDatabase() {
    // Create DB subnet group
    const dbSubnetGroup = new rds.SubnetGroup(this, 'DatabaseSubnetGroup', {
      vpc: this.vpc,
      description: 'Subnet group for Bitbucket RDS database',
      vpcSubnets: {
        subnetType: ec2.SubnetType.PRIVATE_WITH_EGRESS
      }
    });

    // Create RDS PostgreSQL instance
    this.database = new rds.DatabaseInstance(this, 'BitbucketDatabase', {
      engine: rds.DatabaseInstanceEngine.postgres({
        version: rds.PostgresEngineVersion.VER_14_9
      }),
      instanceType: ec2.InstanceType.of(ec2.InstanceClass.T3, ec2.InstanceSize.MICRO),
      vpc: this.vpc,
      subnetGroup: dbSubnetGroup,
      securityGroups: [this.dbSecurityGroup],
      databaseName: 'bitbucket',
      credentials: rds.Credentials.fromGeneratedSecret('bitbucket', {
        description: 'Bitbucket database credentials',
        excludeCharacters: '"@/\\'
      }),
      allocatedStorage: 20,
      maxAllocatedStorage: 100,
      storageType: rds.StorageType.GP2,
      storageEncrypted: true,
      multiAz: false, // Cost optimization for development
      backupRetention: cdk.Duration.days(7),
      deletionProtection: false, // Allow deletion for development
      removalPolicy: cdk.RemovalPolicy.DESTROY, // Allow stack deletion
      enablePerformanceInsights: false, // Cost optimization
      monitoringInterval: cdk.Duration.seconds(0), // Disable enhanced monitoring
      autoMinorVersionUpgrade: true,
      allowMajorVersionUpgrade: false
    });

    // Tag the database
    cdk.Tags.of(this.database).add('Name', `${this.serviceName}-Database`);
    cdk.Tags.of(this.database).add('Component', 'Database');
  }

  createFileSystem() {
    // Create EFS file system
    this.fileSystem = new efs.FileSystem(this, 'BitbucketFileSystem', {
      vpc: this.vpc,
      securityGroup: this.efsSecurityGroup,
      lifecyclePolicy: efs.LifecyclePolicy.AFTER_30_DAYS, // Cost optimization
      performanceMode: efs.PerformanceMode.GENERAL_PURPOSE,
      throughputMode: efs.ThroughputMode.BURSTING,
      encrypted: true,
      removalPolicy: cdk.RemovalPolicy.DESTROY // Allow stack deletion
    });

    // EFS automatically creates mount targets in all subnets when using the vpc parameter
    // No need to manually create mount targets

    // Tag the file system
    cdk.Tags.of(this.fileSystem).add('Name', `${this.serviceName}-FileSystem`);
    cdk.Tags.of(this.fileSystem).add('Component', 'Storage');
  }

  createLoadBalancer() {
    // Create Application Load Balancer
    this.alb = new elbv2.ApplicationLoadBalancer(this, 'BitbucketALB', {
      vpc: this.vpc,
      internetFacing: true,
      securityGroup: this.albSecurityGroup,
      vpcSubnets: {
        subnetType: ec2.SubnetType.PUBLIC
      }
    });

    // Create target group for ECS service (will be attached later)
    this.targetGroup = new elbv2.ApplicationTargetGroup(this, 'BitbucketTargetGroup', {
      port: 7990,
      protocol: elbv2.ApplicationProtocol.HTTP,
      vpc: this.vpc,
      targetType: elbv2.TargetType.IP, // Required for ECS Fargate
      healthCheck: {
        enabled: true,
        path: '/status',
        port: '7990',
        protocol: elbv2.Protocol.HTTP,
        healthyHttpCodes: '200',
        interval: cdk.Duration.seconds(30),
        timeout: cdk.Duration.seconds(10),
        healthyThresholdCount: 3,    // 3 consecutive successes to mark healthy
        unhealthyThresholdCount: 5   // 5 consecutive failures to mark unhealthy (more tolerant)
      },
      deregistrationDelay: cdk.Duration.seconds(30) // Faster deployments
    });

    // Create HTTP listener
    this.alb.addListener('HTTPListener', {
      port: 80,
      protocol: elbv2.ApplicationProtocol.HTTP,
      defaultTargetGroups: [this.targetGroup]
    });

    // Tag the load balancer
    cdk.Tags.of(this.alb).add('Name', `${this.serviceName}-ALB`);
    cdk.Tags.of(this.alb).add('Component', 'LoadBalancer');
  }

  createLogGroup() {
    // Create CloudWatch Log Group for ECS tasks
    this.logGroup = new logs.LogGroup(this, 'BitbucketLogGroup', {
      logGroupName: `/ecs/${this.serviceName}`,
      retention: logs.RetentionDays.ONE_WEEK, // Cost optimization
      removalPolicy: cdk.RemovalPolicy.DESTROY
    });

    // Tag the log group
    cdk.Tags.of(this.logGroup).add('Name', `${this.serviceName}-LogGroup`);
    cdk.Tags.of(this.logGroup).add('Component', 'Logging');
  }
}
