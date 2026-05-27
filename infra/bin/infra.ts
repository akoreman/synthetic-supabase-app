#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Resolve environment from CDK context, env var, or default to preview-<whoami>
const environment: string =
  app.node.tryGetContext('environment') ??
  process.env.ENVIRONMENT ??
  `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// ── 1. Lambda + API Gateway stack ──────────────────────────────────────────
const lambdaStack = new LambdaStack(app, `LambdaStack-${environment}`, {
  environment,
  env,
  tags: {
    Project: 'synthetic-supabase-app',
    ManagedBy: 'CDK',
    Environment: environment,
  },
});

// ── 2. Frontend stack (S3 + CloudFront) ────────────────────────────────────
// Depends on LambdaStack for the API Gateway domain used as CloudFront origin.
const frontendStack = new FrontendStack(app, `FrontendStack-${environment}`, {
  environment,
  buildOutputPath: '../dist',
  apiGatewayDomain: lambdaStack.apiGatewayDomain,
  env,
  tags: {
    Project: 'synthetic-supabase-app',
    ManagedBy: 'CDK',
    Environment: environment,
  },
});

// Explicit dependency: FrontendStack must be deployed after LambdaStack
frontendStack.addDependency(lambdaStack);

// ── 3. Stack-level tags ─────────────────────────────────────────────────────
cdk.Tags.of(app).add('Project', 'synthetic-supabase-app');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
