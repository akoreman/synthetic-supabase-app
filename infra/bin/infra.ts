#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import * as path from 'path';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Derive environment: CDK context > default "preview-<whoami>"
const environment =
  (app.node.tryGetContext('environment') as string) ??
  `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// -----------------------------------------------------------------------
// 1. Lambda Stack — API Gateway + Lambda functions
// -----------------------------------------------------------------------
const lambdaStack = new LambdaStack(app, `LambdaStack-${environment}`, {
  environment,
  env,
});

// -----------------------------------------------------------------------
// 2. Frontend Stack — S3 + CloudFront + /api/* proxy to API Gateway
//    Depends on LambdaStack for the API Gateway domain.
// -----------------------------------------------------------------------
const frontendStack = new FrontendStack(app, `FrontendStack-${environment}`, {
  environment,
  buildOutputPath: path.join(__dirname, '..', '..', 'dist'),
  apiGatewayDomain: lambdaStack.apiGatewayDomain,
  env,
});

// FrontendStack depends on LambdaStack (explicit dependency)
frontendStack.addDependency(lambdaStack);

// -----------------------------------------------------------------------
// 3. Tags applied to all stacks
// -----------------------------------------------------------------------
const appName = 'synthetic-supabase-app';
cdk.Tags.of(app).add('Project', appName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
