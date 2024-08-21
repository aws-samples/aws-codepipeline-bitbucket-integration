# CodePipeline Integration with Bitbucket Server

This blog post demonstrates how to integrate AWS CodePipeline with on-premises Bitbucket Server. If you want to integrate with Bitbucket Cloud, see [AWS CodePipeline Now Supports Atlassian Bitbucket Cloud](https://aws.amazon.com/about-aws/whats-new/2019/12/aws-codepipeline-now-supports-atlassian-bitbucket-cloud/) (Beta). The [AWS Lambda](http://aws.amazon.com/lambda) function provided can get the source code from a Bitbucket Server repository whenever the user sends a new code push and store it in a designed [Amazon Simple Storage Service (Amazon S3) ](https://aws.amazon.com/s3/) bucket.

The Bitbucket Server integration uses webhooks configured in the Bitbucket repository. Webhooks are ideal for this case and avoid the need for performing frequent polling to check for changes in the repository.

Some security protections are available with this solution:

* The [Amazon S3](https://aws.amazon.com/s3/) bucket has encryption enabled using SSE-AES, and every object created is encrypted by default
* The Lambda function accepts only events signed by the Bitbucket Server
* All environment variables used by the Lambda function are encrypted in rest using [AWS KMS](https://aws.amazon.com/kms/)

## Overview
During the creation of the CloudFormation stack, you can select either Amazon API Gateway or Elastic Load Balancing to communicate with the Lambda function. The following diagram shows how the integration works.

![Solution Diagram](assets/diagram.png)

1. The user pushes code to the Bitbucket repository.

1. Based on that user action, the Bitbucket server generates a new webhook event and sends it to Elastic Load Balancing or API Gateway based on which endpoint type you selected during [AWS CloudFormation](https://aws.amazon.com/cloudformation/) stack creation.

1. API Gateway or Elastic Load Balancing forwards the request to the Lambda function, which checks the message signature using the secret configured in the webhook. If the signature is valid, then the Lambda function moves to the next step.

1. The Lambda function calls the Bitbucket server API and requests that it generate a ZIP package with the content of the branch modified by the user in Step 1.

1. The Lambda function sends the ZIP package to the Amazon S3 bucket.

1. CodePipeline is triggered when it detects a new or updated file in the Amazon S3 bucket path.

## Requirements

Before starting the solution setup, make sure you have:


* An Amazon S3 bucket available to store the Lambda function setup files
* NPM or Yarn to install the package dependencies
* [AWS CLI](https://aws.amazon.com/cli/)

## Setup

Follow these steps for setup.

### Creating a personal token on the Bitbucket server

Create a personal token on the Bitbucket server that the Lambda function uses to access the repository.

1. Log in to the Bitbucket server.
1. Choose your user avatar, then choose **Manage Account**.
1. On the **Account** screen, choose **Personal access tokens**.
1. Choose **Create a token**.
1. Fill out the form with the token name. In the **Permissions** section, leave **Read for Projects and Repositories** as is.
1. Choose **Create** to finish.

### Launch a CloudFormation stack
Using the steps below you will upload the Lambda function and Lambda layer ZIP files to an Amazon S3 bucket and launch the AWS CloudFormation stack to create the resources on your AWS account.

1. Clone the Git repository containing the solution source code:
    ```bash
    git clone https://github.com/aws-samples/aws-codepipeline-bitbucket-integration.git
    ```

1. Install the NodeJS packages with npm:

    ```bash
    cd code
    npm install
    cd ..
    ```

1. Prepare the packages for deployment.

    ```bash
    aws cloudformation package --template-file ./infra/infra.yaml --s3-bucket your_bucket_name --output-template-file package.yaml
    ```

1. Edit the AWS CloudFormation parameters file.

    Open the file located at infra/parameters.json in your favorite text editor and replace the parameters accordingly.

    Parameter Name | Description
    ------------ | -------------
    BitbucketSecret | Bitbucket webhook secret used to sign webhook events. You should define the secret and use the same value here and in the Bitbucket server webhook.
    BitbucketServerUrl | URL of your Bitbucket Server, such as https://server:port.
    BitbucketToken | Bitbucket server personal token used by the Lambda function to access the Bitbucket API.
    EndpointType | Select the type of endpoint to integrate with the Lambda function. It can be the Application Load Balancer or the API Gateway.
    LambdaSubnets | Subnets where the Lambda function runs.
    LBCIDR | CIDR allowed to communicate with the Load Balancer. It should allow the Bitbucket server IP address. Leave it blank if you are using the API Gateway endpoint type.
    LBSubnets | Subnets where the Application Load Balancer runs. Leave it blank if you are using the API Gateway endpoint type.
    LBSSLCertificateArn | SSL Certificate to associate with the Application Load Balancer. Leave it blank if you are using the API Gateway endpoint type.
    S3BucketCodePipelineName | Amazon S3 bucket name that this stack creates to store the Bitbucket repository content.
    VPCID | VPC ID where the Application Load Balancer and the Lambda function run.
    WebProxyHost | Hostname of your proxy server used by the Lambda function to access the Bitbucket server, such as myproxy.mydomain.com. If you don’t need a web proxy, leave it blank.
    WebProxyPort | Port of your proxy server used by the Lambda function to access the Bitbucket server, such as 8080. If you don’t need a web proxy leave it blank.

5. Create the CloudFormation stack:

    ```bash
    aws cloudformation create-stack --stack-name CodePipeline-Bitbucket-Integration --template-body file://package.yaml --parameters file://infra/parameters.json --capabilities CAPABILITY_NAMED_IAM
    ```

### Creating a webhook on the Bitbucket Server

Next, create the webhook on Bitbucket server to notify the Lambda function of push events to the repository:

1. Log into the Bitbucket server and navigate to the repository page.
1. Choose **Repository settings**.
1. Select **Webhook**.
1. Choose **Create webhook**.
1. Fill out the form with the name of the webhook, such as CodePipeline.
1. Fill out the **URL** field with the API Gateway or Load Balancer URL. To obtain this URL, choose the **Outputs** tab of the AWS CloudFormation stack.
1. Fill out the Secret field with the same value used in the AWS CloudFormation stack.
1. In the **Events** section, ensure Push is selected.
1. Choose **Create** to finish.
1. Repeat these steps for each repository in which you want to enable the integration.

### Configure your pipeline
Finally, change your pipeline on CodePipeline to use the Amazon S3 bucket created by the AWS CloudFormation stack as the source of your pipeline.

The Lambda function uploads the files to the Amazon S3 bucket using the following path structure:

```
Project Name/Repository Name/Branch Name.zip
```

Now, every time someone pushes code to the Bitbucket repository, your pipeline starts automatically.

## Cleaning up
If you want to remove the integration and clean up the resources created at AWS, you need to delete the CloudFormation stack. Run the command below to delete the stack and associated resources.

```bash
aws cloudformation delete-stack --stack-name CodePipeline-Bitbucket-Integration 
```

## Conclusion
This post demonstrated how to integrate your on-premises Bitbucket Server with CodePipeline.