import { describe, it, expect } from '@jest/globals';
import { Template } from 'aws-cdk-lib/assertions';
import { App } from 'aws-cdk-lib';
import { BitbucketEcsStack } from '../../../infra/bitbucket-server-ecs/lib/bitbucket-ecs-stack';

describe('Cyclic Dependency Validation Tests', () => {
  const testProps = {
    envName: 'test'
  };

  it('should not have cyclic dependencies in CloudFormation template', () => {
    const app = new App();
    const stack = new BitbucketEcsStack(app, 'TestCyclicDependencyStack', testProps);
    
    // This will throw an error if there are cyclic dependencies
    expect(() => {
      const template = Template.fromStack(stack);
      // If we get here, no cyclic dependencies were detected
      expect(template).toBeDefined();
    }).not.toThrow();
  });

  it('should have proper dependency chain for ECS resources', () => {
    const app = new App();
    const stack = new BitbucketEcsStack(app, 'TestDependencyChainStack', testProps);
    const template = Template.fromStack(stack);

    // Verify that the graceful shutdown resource depends on the service
    const resources = template.toJSON().Resources;
    
    // Find the graceful shutdown resource
    const gracefulShutdownResource = Object.values(resources).find(
      resource => resource.Type === 'AWS::CloudFormation::CustomResource' &&
      resource.Properties?.ServiceToken
    );
    
    expect(gracefulShutdownResource).toBeDefined();
    expect(gracefulShutdownResource.DependsOn).toBeDefined();
    
    // The graceful shutdown should depend on the ECS service
    const ecsServiceId = Object.keys(resources).find(
      key => resources[key].Type === 'AWS::ECS::Service'
    );
    
    expect(gracefulShutdownResource.DependsOn).toContain(ecsServiceId);
  });

  it('should not have cluster depending on graceful shutdown resource', () => {
    const app = new App();
    const stack = new BitbucketEcsStack(app, 'TestClusterDependencyStack', testProps);
    const template = Template.fromStack(stack);

    const resources = template.toJSON().Resources;
    
    // Find the ECS cluster
    const ecsCluster = Object.values(resources).find(
      resource => resource.Type === 'AWS::ECS::Cluster'
    );
    
    expect(ecsCluster).toBeDefined();
    
    // Find the graceful shutdown resource ID
    const gracefulShutdownResourceId = Object.keys(resources).find(
      key => resources[key].Type === 'AWS::CloudFormation::CustomResource' &&
      resources[key].Properties?.ServiceToken
    );
    
    // The cluster should NOT depend on the graceful shutdown resource
    // (this was the source of the cyclic dependency)
    if (ecsCluster.DependsOn) {
      expect(ecsCluster.DependsOn).not.toContain(gracefulShutdownResourceId);
    }
  });

  it('should synthesize template without errors', () => {
    const app = new App();
    new BitbucketEcsStack(app, 'TestSynthesisStack', testProps);
    
    // This should not throw any errors
    expect(() => {
      app.synth();
    }).not.toThrow();
  });
});
