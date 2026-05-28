#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';
import * as path from 'path';

const app = new cdk.App();

// Resolve environment from CDK context, or default to preview-<whoami>
const environment: string =
  (app.node.tryGetContext('environment') as string | undefined) ??
  `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// 1. Lambda stack (API Gateway + Lambda functions)
const lambdaStack = new LambdaStack(app, `App-${environment}-Lambda`, {
  environment,
  env,
});

// 2. Frontend stack (S3 + CloudFront + /api/* proxy to API Gateway)
//    Build output is at <repo-root>/dist relative to this bin file
const buildOutputPath = path.join(__dirname, '..', '..', 'dist');

const frontendStack = new FrontendStack(app, `App-${environment}-Frontend`, {
  environment,
  buildOutputPath,
  apiGatewayDomain: lambdaStack.apiGatewayDomain,
  env,
});

// Frontend depends on Lambda stack being deployed first (needs apiGatewayDomain)
frontendStack.addDependency(lambdaStack);

// 3. Tags applied to all resources in both stacks
const tags = {
  Project: 'App',
  ManagedBy: 'CDK',
  Environment: environment,
};

for (const [key, value] of Object.entries(tags)) {
  cdk.Tags.of(app).add(key, value);
}
