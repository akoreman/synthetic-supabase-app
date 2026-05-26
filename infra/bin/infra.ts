#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import * as path from 'path';
import * as os from 'os';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Resolve environment: CDK context -c environment=<env>, else preview-<whoami>
const environment: string =
  app.node.tryGetContext('environment') ?? `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// 1. Lambda stack (API Gateway + Lambda functions)
const lambdaStack = new LambdaStack(app, `LambdaStack-${environment}`, {
  environment,
  env,
});

// 2. Frontend stack (S3 + CloudFront + /api/* proxy to API Gateway)
//    Build output path is relative to this bin/ file → repo root dist/
const buildOutputPath = path.join(__dirname, '..', '..', 'dist');

const frontendStack = new FrontendStack(app, `FrontendStack-${environment}`, {
  environment,
  buildOutputPath,
  apiGatewayDomain: lambdaStack.apiGatewayDomain,
  env,
});

// Frontend depends on Lambda (needs the API Gateway domain at synth time)
frontendStack.addDependency(lambdaStack);

// -------------------------------------------------------------------
// Tags applied to all resources in both stacks
// -------------------------------------------------------------------
cdk.Tags.of(app).add('Project', 'synthetic-supabase-app');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
