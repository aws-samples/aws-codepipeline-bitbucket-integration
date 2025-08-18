#!/usr/bin/env python3
"""
Script para gerar o diagrama de arquitetura do AWS CodePipeline Bitbucket Integration.
Este script usa a biblioteca diagrams para criar um diagrama visual da arquitetura.

Requisitos:
- Python 3.7+
- Biblioteca diagrams (pip install diagrams)
- Graphviz instalado no sistema

Uso:
python generate_architecture_diagram.py
"""

from diagrams import Diagram, Cluster, Edge
from diagrams.aws.compute import Lambda
from diagrams.aws.network import APIGateway
from diagrams.aws.integration import SQS
from diagrams.aws.storage import S3
from diagrams.aws.database import Dynamodb
from diagrams.aws.devtools import Codepipeline
from diagrams.aws.security import SecretsManager
from diagrams.aws.management import Cloudwatch
from diagrams.onprem.compute import Server
from diagrams.aws.general import User

def generate_diagram():
    """Gera o diagrama de arquitetura do AWS CodePipeline Bitbucket Integration."""
    with Diagram(
        "AWS CodePipeline Bitbucket Integration", 
        show=False, 
        direction="LR", 
        filename="aws-bitbucket-integration",
        outformat="png"
    ):
        # External components
        developer = User("Developer")
        bitbucket = Server("Bitbucket Server\nPush Event")
        
        # Main flow components
        with Cluster("AWS Cloud"):
            # API Gateway and webhook handler
            with Cluster("Webhook Processing"):
                api = APIGateway("API Gateway\nWebhook Endpoint")
                webhook_lambda = Lambda("Webhook Handler\nLambda")
                queue = SQS("SQS Queue\nAsync Processing")
                dlq = SQS("Dead Letter Queue\nFailed Messages")
            
            # Repository processing
            with Cluster("Repository Processing"):
                repo_lambda = Lambda("Repository Processor\nLambda")
                dynamo = Dynamodb("DynamoDB\nRepository Mapping")
                source_bucket = S3("S3 Sources Bucket\nRepository ZIP")
            
            # Pipeline execution
            with Cluster("CI/CD Pipeline"):
                pipeline = Codepipeline("CodePipeline\nCI/CD Execution")
                artifacts_bucket = S3("S3 Artifacts Bucket\nBuild Artifacts")
            
            # Shared resources
            with Cluster("Shared Resources"):
                secrets = SecretsManager("Secrets Manager\nCredentials")
                monitoring = Cloudwatch("CloudWatch\nMonitoring")
                lambda_layer = Lambda("Shared Lambda Layer\nCommon Code")
        
        # Flow connections with numbered steps
        developer >> Edge(label="1️⃣") >> bitbucket
        bitbucket >> Edge(label="2️⃣") >> api
        api >> Edge(label="3️⃣") >> webhook_lambda
        webhook_lambda >> Edge(label="4️⃣") >> queue
        queue >> Edge(label="5️⃣") >> repo_lambda
        queue >> Edge(style="dashed", color="red") >> dlq
        
        repo_lambda >> Edge(label="5️⃣") >> dynamo
        repo_lambda >> Edge(label="6️⃣") >> source_bucket
        repo_lambda >> Edge(label="7️⃣") >> pipeline
        pipeline >> Edge(label="8️⃣") >> artifacts_bucket
        
        # Dashed connections for supporting resources
        webhook_lambda >> Edge(style="dashed") >> secrets
        repo_lambda >> Edge(style="dashed") >> secrets
        
        webhook_lambda >> Edge(style="dashed") >> lambda_layer
        repo_lambda >> Edge(style="dashed") >> lambda_layer
        
        monitoring >> Edge(style="dashed") >> webhook_lambda
        monitoring >> Edge(style="dashed") >> repo_lambda

if __name__ == "__main__":
    generate_diagram()
    print("Diagrama gerado com sucesso em 'generated-diagrams/aws-bitbucket-integration.png'")
