#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import * as path from 'path';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Resolve environment from CDK context, falling back to preview-<whoami>
const environment: string =
  (app.node.tryGetContext('environment') as string | undefined) ??
  `preview-${os.userInfo().username}`;

const env: cdk.Environment = {
  account: process.env.CDK_DEFAULT_ACCOUNT,
  region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};

// ── Lambda Stack (API Gateway + Lambda functions) ──────────────────────────
const lambdaStack = new LambdaStack(
  app,
  `SyntheticSupabaseApp-Lambda-${environment}`,
  { environment, env }
);

// ── Frontend Stack (S3 + CloudFront + /api/* proxy) ────────────────────────
// buildOutputPath is relative to infra/bin/ → go up two levels to repo root
const buildOutputPath = path.resolve(__dirname, '..', '..', 'dist');

const frontendStack = new FrontendStack(
  app,
  `SyntheticSupabaseApp-Frontend-${environment}`,
  {
    environment,
    buildOutputPath,
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
  }
);

// Frontend depends on Lambda so CDK orders deployment correctly
frontendStack.addDependency(lambdaStack);

// ── Tags ───────────────────────────────────────────────────────────────────
cdk.Tags.of(app).add('Project', 'SyntheticSupabaseApp');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
