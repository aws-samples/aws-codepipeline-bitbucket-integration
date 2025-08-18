import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface PipelineFactoryStackProps extends cdk.StackProps {
    pipelineName: string;
    repositoryKey: string;
    branch: string;
    sourceBucket: string;
    artifactsBucket: string;
    environment?: string;
    projectWithPrefix?: string;
    repoWithPrefix?: string;
    uniqueSuffix?: string;
}
export declare class PipelineFactoryStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props: PipelineFactoryStackProps);
}
