"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PipelineFactoryStack = void 0;
const cdk = require("aws-cdk-lib");
const codepipeline = require("aws-cdk-lib/aws-codepipeline");
const codepipeline_actions = require("aws-cdk-lib/aws-codepipeline-actions");
const codebuild = require("aws-cdk-lib/aws-codebuild");
const s3 = require("aws-cdk-lib/aws-s3");
const secretsmanager = require("aws-cdk-lib/aws-secretsmanager");
class PipelineFactoryStack extends cdk.Stack {
    constructor(scope, id, props) {
        super(scope, id, props);
        const { pipelineName, repositoryKey, branch, sourceBucket, artifactsBucket, environment = 'dev', projectWithPrefix, repoWithPrefix, uniqueSuffix: providedSuffix } = props;
        // Create webhook secret for this repository
        const webhookSecret = new secretsmanager.Secret(this, 'WebhookSecret', {
            secretName: `bitbucket-integration-v2/${environment}/webhook-secret/${repositoryKey}`,
            description: `Webhook secret for repository ${repositoryKey}`,
            generateSecretString: {
                secretStringTemplate: JSON.stringify({ secret: '' }),
                generateStringKey: 'secret',
                excludeCharacters: '"@/\\',
                passwordLength: 64
            }
        });
        // Import existing S3 buckets
        const sourceS3Bucket = s3.Bucket.fromBucketName(this, 'SourceBucket', sourceBucket);
        const artifactsS3Bucket = s3.Bucket.fromBucketName(this, 'ArtifactsBucket', artifactsBucket);
        // Determine resource naming based on provided prefixes or fallback to original naming
        let resourcePrefix;
        if (projectWithPrefix && repoWithPrefix) {
            resourcePrefix = `${projectWithPrefix}-${repoWithPrefix}`;
        }
        else {
            // Extract and sanitize components from repositoryKey if prefixes not provided
            const [project, repo] = repositoryKey.split('/');
            // Function to simplify names
            const simplifyName = (name) => {
                return name.replace(/[^a-zA-Z0-9]/g, '');
            };
            const simplifiedProject = simplifyName(project || 'default');
            const simplifiedRepo = simplifyName(repo || 'repo');
            resourcePrefix = `Proj${simplifiedProject}-Repo${simplifiedRepo}`;
        }
        // Generate names for resources without suffix
        const uniquePipelineName = `${resourcePrefix}-Pipeline`;
        // CodeBuild project with unique name
        const buildProject = new codebuild.Project(this, 'BuildProject', {
            projectName: `${resourcePrefix}-Build`,
            environment: {
                buildImage: codebuild.LinuxBuildImage.STANDARD_5_0,
                computeType: codebuild.ComputeType.SMALL,
            },
            buildSpec: codebuild.BuildSpec.fromObject({
                version: '0.2',
                phases: {
                    pre_build: {
                        commands: [
                            'echo Build started on `date`',
                            'ls -la',
                        ],
                    },
                    build: {
                        commands: [
                            'echo Compiling the source code...',
                            '# Add your build commands here',
                            'echo "Build completed successfully"',
                        ],
                    },
                    post_build: {
                        commands: [
                            'echo Build completed on `date`',
                        ],
                    },
                },
                artifacts: {
                    files: [
                        '**/*',
                    ],
                },
            }),
        });
        // Grant permissions to read from source bucket
        sourceS3Bucket.grantRead(buildProject);
        // Create artifacts
        const sourceOutput = new codepipeline.Artifact('SourceOutput');
        const buildOutput = new codepipeline.Artifact('BuildOutput');
        // Sanitize S3 key components to match repository-processor logic
        const sanitizeS3KeyComponent = (component) => {
            return component
                .replace(/[^a-zA-Z0-9\-_.]/g, '-') // Replace invalid chars with dash
                .replace(/-+/g, '-') // Replace multiple dashes with single dash
                .replace(/^-|-$/g, '') // Remove leading/trailing dashes
                .toLowerCase();
        };
        // Extract components from repositoryKey (assuming format: project/repo)
        const [project, repo] = repositoryKey.split('/');
        // Use sanitized components to build bucketKey
        const bucketKey = `repositories/${sanitizeS3KeyComponent(project)}/${sanitizeS3KeyComponent(repo)}/${sanitizeS3KeyComponent(branch)}/source.zip`;
        // Create pipeline
        const pipeline = new codepipeline.Pipeline(this, 'Pipeline', {
            pipelineName: uniquePipelineName,
            artifactBucket: artifactsS3Bucket,
            stages: [
                {
                    stageName: 'Source',
                    actions: [
                        new codepipeline_actions.S3SourceAction({
                            actionName: 'S3Source',
                            bucket: sourceS3Bucket,
                            bucketKey: bucketKey,
                            output: sourceOutput,
                            // Lambda triggers pipeline manually, no S3 trigger needed
                            trigger: codepipeline_actions.S3Trigger.EVENTS,
                        }),
                    ],
                },
                {
                    stageName: 'Build',
                    actions: [
                        new codepipeline_actions.CodeBuildAction({
                            actionName: 'CodeBuild',
                            project: buildProject,
                            input: sourceOutput,
                            outputs: [buildOutput],
                        }),
                    ],
                },
            ],
        });
        // Outputs
        new cdk.CfnOutput(this, 'PipelineName', {
            value: pipeline.pipelineName,
            description: 'Name of the created pipeline',
        });
        new cdk.CfnOutput(this, 'PipelineArn', {
            value: pipeline.pipelineArn,
            description: 'ARN of the created pipeline',
        });
        new cdk.CfnOutput(this, 'BuildProjectName', {
            value: buildProject.projectName,
            description: 'Name of the CodeBuild project',
        });
        new cdk.CfnOutput(this, 'WebhookSecretName', {
            value: webhookSecret.secretName,
            description: 'Name of the webhook secret for this repository',
        });
    }
}
exports.PipelineFactoryStack = PipelineFactoryStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoicGlwZWxpbmUtZmFjdG9yeS1zdGFjay5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzIjpbInBpcGVsaW5lLWZhY3Rvcnktc3RhY2sudHMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6Ijs7O0FBQUEsbUNBQW1DO0FBQ25DLDZEQUE2RDtBQUM3RCw2RUFBNkU7QUFDN0UsdURBQXVEO0FBRXZELHlDQUF5QztBQUN6QyxpRUFBaUU7QUFlakUsTUFBYSxvQkFBcUIsU0FBUSxHQUFHLENBQUMsS0FBSztJQUNqRCxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQWdDO1FBQ3hFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFDSixZQUFZLEVBQ1osYUFBYSxFQUNiLE1BQU0sRUFDTixZQUFZLEVBQ1osZUFBZSxFQUNmLFdBQVcsR0FBRyxLQUFLLEVBQ25CLGlCQUFpQixFQUNqQixjQUFjLEVBQ2QsWUFBWSxFQUFFLGNBQWMsRUFDN0IsR0FBRyxLQUFLLENBQUM7UUFFViw0Q0FBNEM7UUFDNUMsTUFBTSxhQUFhLEdBQUcsSUFBSSxjQUFjLENBQUMsTUFBTSxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDckUsVUFBVSxFQUFFLDRCQUE0QixXQUFXLG1CQUFtQixhQUFhLEVBQUU7WUFDckYsV0FBVyxFQUFFLGlDQUFpQyxhQUFhLEVBQUU7WUFDN0Qsb0JBQW9CLEVBQUU7Z0JBQ3BCLG9CQUFvQixFQUFFLElBQUksQ0FBQyxTQUFTLENBQUMsRUFBRSxNQUFNLEVBQUUsRUFBRSxFQUFFLENBQUM7Z0JBQ3BELGlCQUFpQixFQUFFLFFBQVE7Z0JBQzNCLGlCQUFpQixFQUFFLE9BQU87Z0JBQzFCLGNBQWMsRUFBRSxFQUFFO2FBQ25CO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsNkJBQTZCO1FBQzdCLE1BQU0sY0FBYyxHQUFHLEVBQUUsQ0FBQyxNQUFNLENBQUMsY0FBYyxDQUFDLElBQUksRUFBRSxjQUFjLEVBQUUsWUFB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RSxhQUFhLEVBQUU7WUFDckMsS0FBSyxFQUFFLFFBQVEsQ0FBQyxXQUFXO1lBQzNCLFdBQVcsRUFBRSw2QkFBNkI7U0FDM0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsWUFBWSxDQUFDLFdBQVc7WUFDL0IsV0FBVyxFQUFFLCtCQUErQjtTQUM3QyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLG1CQUFtQixFQUFFO1lBQzNDLEtBQUssRUFBRSxhQUFhLENBQUMsVUFBVTtZQUMvQixXQUFXLEVBQUUsZ0RBQWdEO1NBQzlELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQXRLRCxvREFzS0MiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY29kZXBpcGVsaW5lIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jb2RlcGlwZWxpbmUnO1xuaW1wb3J0ICogYXMgY29kZXBpcGVsaW5lX2FjdGlvbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNvZGVwaXBlbGluZS1hY3Rpb25zJztcbmltcG9ydCAqIGFzIGNvZGVidWlsZCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY29kZWJ1aWxkJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIHMzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMyc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgUGlwZWxpbmVGYWN0b3J5U3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgcGlwZWxpbmVOYW1lOiBzdHJpbmc7XG4gIHJlcG9zaXRvcnlLZXk6IHN0cmluZztcbiAgYnJhbmNoOiBzdHJpbmc7XG4gIHNvdXJjZUJ1Y2tldDogc3RyaW5nO1xuICBhcnRpZmFjdHNCdWNrZXQ6IHN0cmluZztcbiAgZW52aXJvbm1lbnQ/OiBzdHJpbmc7XG4gIHByb2plY3RXaXRoUHJlZml4Pzogc3RyaW5nO1xuICByZXBvV2l0aFByZWZpeD86IHN0cmluZztcbiAgdW5pcXVlU3VmZml4Pzogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgUGlwZWxpbmVGYWN0b3J5U3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogUGlwZWxpbmVGYWN0b3J5U3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBcbiAgICAgIHBpcGVsaW5lTmFtZSwgXG4gICAgICByZXBvc2l0b3J5S2V5LCBcbiAgICAgIGJyYW5jaCwgXG4gICAgICBzb3VyY2VCdWNrZXQsXG4gICAgICBhcnRpZmFjdHNCdWNrZXQsIFxuICAgICAgZW52aXJvbm1lbnQgPSAnZGV2JyxcbiAgICAgIHByb2plY3RXaXRoUHJlZml4LFxuICAgICAgcmVwb1dpdGhQcmVmaXgsXG4gICAgICB1bmlxdWVTdWZmaXg6IHByb3ZpZGVkU3VmZml4XG4gICAgfSA9IHByb3BzO1xuXG4gICAgLy8gQ3JlYXRlIHdlYmhvb2sgc2VjcmV0IGZvciB0aGlzIHJlcG9zaXRvcnlcbiAgICBjb25zdCB3ZWJob29rU2VjcmV0ID0gbmV3IHNlY3JldHNtYW5hZ2VyLlNlY3JldCh0aGlzLCAnV2ViaG9va1NlY3JldCcsIHtcbiAgICAgIHNlY3JldE5hbWU6IGBiaXRidWNrZXQtaW50ZWdyYXRpb24tdjIvJHtlbnZpcm9ubWVudH0vd2ViaG9vay1zZWNyZXQvJHtyZXBvc2l0b3J5S2V5fWAsXG4gICAgICBkZXNjcmlwdGlvbjogYFdlYmhvb2sgc2VjcmV0IGZvciByZXBvc2l0b3J5ICR7cmVwb3NpdG9yeUtleX1gLFxuICAgICAgZ2VuZXJhdGVTZWNyZXRTdHJpbmc6IHtcbiAgICAgICAgc2VjcmV0U3RyaW5nVGVtcGxhdGU6IEpTT04uc3RyaW5naWZ5KHsgc2VjcmV0OiAnJyB9KSxcbiAgICAgICAgZ2VuZXJhdGVTdHJpbmdLZXk6ICdzZWNyZXQnLFxuICAgICAgICBleGNsdWRlQ2hhcmFjdGVyczogJ1wiQC9cXFxcJyxcbiAgICAgICAgcGFzc3dvcmRMZW5ndGg6IDY0XG4gICAgICB9XG4gICAgfSk7XG5cbiAgICAvLyBJbXBvcnQgZXhpc3RpbmcgUzMgYnVja2V0c1xuICAgIGNvbnN0IHNvdXJjZVMzQnVja2V0ID0gczMuQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsICdTb3VyY2VCdWNrZXQnLCBzb3VyY2VCdWNrZXQpO1xuICAgIGNvbnN0IGFydGlmYWN0c1MzQnVja2V0ID0gczMuQnVja2V0LmZyb21CdWNrZXROYW1lKHRoaXMsICdBcnRpZmFjdHNCdWNrZXQnLCBhcnRpZmFjdHNCdWNrZXQpO1xuXG4gICAgLy8gRGV0ZXJtaW5lIHJlc291cmNlIG5hbWluZyBiYXNlZCBvbiBwcm92aWRlZCBwcmVmaXhlcyBvciBmYWxsYmFjayB0byBvcmlnaW5hbCBuYW1pbmdcbiAgICBsZXQgcmVzb3VyY2VQcmVmaXg6IHN0cmluZztcbiAgICBpZiAocHJvamVjdFdpdGhQcmVmaXggJiYgcmVwb1dpdGhQcmVmaXgpIHtcbiAgICAgIHJlc291cmNlUHJlZml4ID0gYCR7cHJvamVjdFdpdGhQcmVmaXh9LSR7cmVwb1dpdGhQcmVmaXh9YDtcbiAgICB9IGVsc2Uge1xuICAgICAgLy8gRXh0cmFjdCBhbmQgc2FuaXRpemUgY29tcG9uZW50cyBmcm9tIHJlcG9zaXRvcnlLZXkgaWYgcHJlZml4ZXMgbm90IHByb3ZpZGVkXG4gICAgICBjb25zdCBbcHJvamVjdCwgcmVwb10gPSByZXBvc2l0b3J5S2V5LnNwbGl0KCcvJyk7XG4gICAgICBcbiAgICAgIC8vIEZ1bmN0aW9uIHRvIHNpbXBsaWZ5IG5hbWVzXG4gICAgICBjb25zdCBzaW1wbGlmeU5hbWUgPSAobmFtZTogc3RyaW5nKTogc3RyaW5nID0+IHtcbiAgICAgICAgcmV0dXJuIG5hbWUucmVwbGFjZSgvW15hLXpBLVowLTldL2csICcnKTtcbiAgICAgIH07XG4gICAgICBcbiAgICAgIGNvbnN0IHNpbXBsaWZpZWRQcm9qZWN0ID0gc2ltcGxpZnlOYW1lKHByb2plY3QgfHwgJ2RlZmF1bHQnKTtcbiAgICAgIGNvbnN0IHNpbXBsaWZpZWRSZXBvID0gc2ltcGxpZnlOYW1lKHJlcG8gfHwgJ3JlcG8nKTtcbiAgICAgIFxuICAgICAgcmVzb3VyY2VQcmVmaXggPSBgUHJvaiR7c2ltcGxpZmllZFByb2plY3R9LVJlcG8ke3NpbXBsaWZpZWRSZXBvfWA7XG4gICAgfVxuICAgIFxuICAgIC8vIEdlbmVyYXRlIG5hbWVzIGZvciByZXNvdXJjZXMgd2l0aG91dCBzdWZmaXhcbiAgICBjb25zdCB1bmlxdWVQaXBlbGluZU5hbWUgPSBgJHtyZXNvdXJjZVByZWZpeH0tUGlwZWxpbmVgO1xuICAgIFxuICAgIC8vIENvZGVCdWlsZCBwcm9qZWN0IHdpdGggdW5pcXVlIG5hbWVcbiAgICBjb25zdCBidWlsZFByb2plY3QgPSBuZXcgY29kZWJ1aWxkLlByb2plY3QodGhpcywgJ0J1aWxkUHJvamVjdCcsIHtcbiAgICAgIHByb2plY3ROYW1lOiBgJHtyZXNvdXJjZVByZWZpeH0tQnVpbGRgLFxuICAgICAgZW52aXJvbm1lbnQ6IHtcbiAgICAgICAgYnVpbGRJbWFnZTogY29kZWJ1aWxkLkxpbnV4QnVpbGRJbWFnZS5TVEFOREFSRF81XzAsXG4gICAgICAgIGNvbXB1dGVUeXBlOiBjb2RlYnVpbGQuQ29tcHV0ZVR5cGUuU01BTEwsXG4gICAgICB9LFxuICAgICAgYnVpbGRTcGVjOiBjb2RlYnVpbGQuQnVpbGRTcGVjLmZyb21PYmplY3Qoe1xuICAgICAgICB2ZXJzaW9uOiAnMC4yJyxcbiAgICAgICAgcGhhc2VzOiB7XG4gICAgICAgICAgcHJlX2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZCBzdGFydGVkIG9uIGBkYXRlYCcsXG4gICAgICAgICAgICAgICdscyAtbGEnLFxuICAgICAgICAgICAgXSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIGJ1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBDb21waWxpbmcgdGhlIHNvdXJjZSBjb2RlLi4uJyxcbiAgICAgICAgICAgICAgJyMgQWRkIHlvdXIgYnVpbGQgY29tbWFuZHMgaGVyZScsXG4gICAgICAgICAgICAgICdlY2hvIFwiQnVpbGQgY29tcGxldGVkIHN1Y2Nlc3NmdWxseVwiJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgICBwb3N0X2J1aWxkOiB7XG4gICAgICAgICAgICBjb21tYW5kczogW1xuICAgICAgICAgICAgICAnZWNobyBCdWlsZCBjb21wbGV0ZWQgb24gYGRhdGVgJyxcbiAgICAgICAgICAgIF0sXG4gICAgICAgICAgfSxcbiAgICAgICAgfSxcbiAgICAgICAgYXJ0aWZhY3RzOiB7XG4gICAgICAgICAgZmlsZXM6IFtcbiAgICAgICAgICAgICcqKi8qJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSksXG4gICAgfSk7XG5cbiAgICAvLyBHcmFudCBwZXJtaXNzaW9ucyB0byByZWFkIGZyb20gc291cmNlIGJ1Y2tldFxuICAgIHNvdXJjZVMzQnVja2V0LmdyYW50UmVhZChidWlsZFByb2plY3QpO1xuXG4gICAgLy8gQ3JlYXRlIGFydGlmYWN0c1xuICAgIGNvbnN0IHNvdXJjZU91dHB1dCA9IG5ldyBjb2RlcGlwZWxpbmUuQXJ0aWZhY3QoJ1NvdXJjZU91dHB1dCcpO1xuICAgIGNvbnN0IGJ1aWxkT3V0cHV0ID0gbmV3IGNvZGVwaXBlbGluZS5BcnRpZmFjdCgnQnVpbGRPdXRwdXQnKTtcblxuICAgIC8vIFNhbml0aXplIFMzIGtleSBjb21wb25lbnRzIHRvIG1hdGNoIHJlcG9zaXRvcnktcHJvY2Vzc29yIGxvZ2ljXG4gICAgY29uc3Qgc2FuaXRpemVTM0tleUNvbXBvbmVudCA9IChjb21wb25lbnQ6IHN0cmluZyk6IHN0cmluZyA9PiB7XG4gICAgICByZXR1cm4gY29tcG9uZW50XG4gICAgICAgIC5yZXBsYWNlKC9bXmEtekEtWjAtOVxcLV8uXS9nLCAnLScpIC8vIFJlcGxhY2UgaW52YWxpZCBjaGFycyB3aXRoIGRhc2hcbiAgICAgICAgLnJlcGxhY2UoLy0rL2csICctJykgICAgICAgICAgICAgICAvLyBSZXBsYWNlIG11bHRpcGxlIGRhc2hlcyB3aXRoIHNpbmdsZSBkYXNoXG4gICAgICAgIC5yZXBsYWNlKC9eLXwtJC9nLCAnJykgICAgICAgICAgICAgLy8gUmVtb3ZlIGxlYWRpbmcvdHJhaWxpbmcgZGFzaGVzXG4gICAgICAgIC50b0xvd2VyQ2FzZSgpO1xuICAgIH07XG5cbiAgICAvLyBFeHRyYWN0IGNvbXBvbmVudHMgZnJvbSByZXBvc2l0b3J5S2V5IChhc3N1bWluZyBmb3JtYXQ6IHByb2plY3QvcmVwbylcbiAgICBjb25zdCBbcHJvamVjdCwgcmVwb10gPSByZXBvc2l0b3J5S2V5LnNwbGl0KCcvJyk7XG5cbiAgICAvLyBVc2Ugc2FuaXRpemVkIGNvbXBvbmVudHMgdG8gYnVpbGQgYnVja2V0S2V5XG4gICAgY29uc3QgYnVja2V0S2V5ID0gYHJlcG9zaXRvcmllcy8ke3Nhbml0aXplUzNLZXlDb21wb25lbnQocHJvamVjdCl9LyR7c2FuaXRpemVTM0tleUNvbXBvbmVudChyZXBvKX0vJHtzYW5pdGl6ZVMzS2V5Q29tcG9uZW50KGJyYW5jaCl9L3NvdXJjZS56aXBgO1xuXG4gICAgLy8gQ3JlYXRlIHBpcGVsaW5lXG4gICAgY29uc3QgcGlwZWxpbmUgPSBuZXcgY29kZXBpcGVsaW5lLlBpcGVsaW5lKHRoaXMsICdQaXBlbGluZScsIHtcbiAgICAgIHBpcGVsaW5lTmFtZTogdW5pcXVlUGlwZWxpbmVOYW1lLFxuICAgICAgYXJ0aWZhY3RCdWNrZXQ6IGFydGlmYWN0c1MzQnVja2V0LFxuICAgICAgc3RhZ2VzOiBbXG4gICAgICAgIHtcbiAgICAgICAgICBzdGFnZU5hbWU6ICdTb3VyY2UnLFxuICAgICAgICAgIGFjdGlvbnM6IFtcbiAgICAgICAgICAgIG5ldyBjb2RlcGlwZWxpbmVfYWN0aW9ucy5TM1NvdXJjZUFjdGlvbih7XG4gICAgICAgICAgICAgIGFjdGlvbk5hbWU6ICdTM1NvdXJjZScsXG4gICAgICAgICAgICAgIGJ1Y2tldDogc291cmNlUzNCdWNrZXQsXG4gICAgICAgICAgICAgIGJ1Y2tldEtleTogYnVja2V0S2V5LFxuICAgICAgICAgICAgICBvdXRwdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICAgICAgLy8gTGFtYmRhIHRyaWdnZXJzIHBpcGVsaW5lIG1hbnVhbGx5LCBubyBTMyB0cmlnZ2VyIG5lZWRlZFxuICAgICAgICAgICAgICB0cmlnZ2VyOiBjb2RlcGlwZWxpbmVfYWN0aW9ucy5TM1RyaWdnZXIuRVZFTlRTLFxuICAgICAgICAgICAgfSksXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAge1xuICAgICAgICAgIHN0YWdlTmFtZTogJ0J1aWxkJyxcbiAgICAgICAgICBhY3Rpb25zOiBbXG4gICAgICAgICAgICBuZXcgY29kZXBpcGVsaW5lX2FjdGlvbnMuQ29kZUJ1aWxkQWN0aW9uKHtcbiAgICAgICAgICAgICAgYWN0aW9uTmFtZTogJ0NvZGVCdWlsZCcsXG4gICAgICAgICAgICAgIHByb2plY3Q6IGJ1aWxkUHJvamVjdCxcbiAgICAgICAgICAgICAgaW5wdXQ6IHNvdXJjZU91dHB1dCxcbiAgICAgICAgICAgICAgb3V0cHV0czogW2J1aWxkT3V0cHV0XSxcbiAgICAgICAgICAgIH0pLFxuICAgICAgICAgIF0sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gT3V0cHV0c1xuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQaXBlbGluZU5hbWUnLCB7XG4gICAgICB2YWx1ZTogcGlwZWxpbmUucGlwZWxpbmVOYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdOYW1lIG9mIHRoZSBjcmVhdGVkIHBpcGVsaW5lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdQaXBlbGluZUFybicsIHtcbiAgICAgIHZhbHVlOiBwaXBlbGluZS5waXBlbGluZUFybixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVJOIG9mIHRoZSBjcmVhdGVkIHBpcGVsaW5lJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdCdWlsZFByb2plY3ROYW1lJywge1xuICAgICAgdmFsdWU6IGJ1aWxkUHJvamVjdC5wcm9qZWN0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgQ29kZUJ1aWxkIHByb2plY3QnLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ1dlYmhvb2tTZWNyZXROYW1lJywge1xuICAgICAgdmFsdWU6IHdlYmhvb2tTZWNyZXQuc2VjcmV0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnTmFtZSBvZiB0aGUgd2ViaG9vayBzZWNyZXQgZm9yIHRoaXMgcmVwb3NpdG9yeScsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==