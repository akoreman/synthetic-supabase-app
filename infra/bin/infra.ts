#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import * as path from 'path';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Resolve environment from CDK context, env var, or default to preview-<whoami>
const environment: string =
  (app.node.tryGetContext('environment') as string | undefined) ??
  process.env['ENVIRONMENT'] ??
  `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env['CDK_DEFAULT_ACCOUNT'],
  region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
};

const tags: Record<string, string> = {
  Project: 'SyntheticSupabaseApp',
  ManagedBy: 'CDK',
  Environment: environment,
};

// -------------------------------------------------------------------------
// 1. Lambda Stack — API Gateway + Lambda functions
// -------------------------------------------------------------------------
const lambdaStack = new LambdaStack(
  app,
  `SyntheticSupabaseApp-Lambda-${environment}`,
  {
    environment,
    env,
    tags,
  }
);

// -------------------------------------------------------------------------
// 2. Frontend Stack — S3 + CloudFront + /api/* proxy to API Gateway
//    Depends on LambdaStack for apiGatewayDomain
// -------------------------------------------------------------------------
const frontendStack = new FrontendStack(
  app,
  `SyntheticSupabaseApp-Frontend-${environment}`,
  {
    environment,
    // Resolve dist/ relative to the repo root (one level above infra/)
    buildOutputPath: path.join(__dirname, '..', '..', 'dist'),
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
    tags,
  }
);

// Frontend explicitly depends on Lambda (API Gateway must exist first)
frontendStack.addDependency(lambdaStack);

// Apply tags to every resource in both stacks
Object.entries(tags).forEach(([key, value]) => {
  cdk.Tags.of(lambdaStack).add(key, value);
  cdk.Tags.of(frontendStack).add(key, value);
});

app.synth();
