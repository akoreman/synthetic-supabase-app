#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import * as os from 'os';
import * as path from 'path';
import { LambdaStack } from '../lib/stacks/lambda-stack';
import { FrontendStack } from '../lib/stacks/frontend-stack';

const app = new cdk.App();

// Resolve environment from CDK context or default to preview-<whoami>
const environment: string =
  (app.node.tryGetContext('environment') as string | undefined) ??
  `preview-${os.userInfo().username}`;

// Tags applied to all stacks
const commonTags: Record<string, string> = {
  Project: 'synthetic-supabase-app',
  ManagedBy: 'CDK',
  Environment: environment,
};

// --- Lambda Stack (API Gateway + Lambda functions) ---
const lambdaStack = new LambdaStack(app, `SyntheticSupabaseApp-Lambda-${environment}`, {
  environment,
  description: `Lambda + API Gateway stack for synthetic-supabase-app (${environment})`,
});

// --- Frontend Stack (S3 + CloudFront + /api/* proxy) ---
const frontendStack = new FrontendStack(app, `SyntheticSupabaseApp-Frontend-${environment}`, {
  environment,
  buildOutputPath: path.join(__dirname, '..', '..', 'dist'),
  apiGatewayDomain: lambdaStack.apiGatewayDomain,
  description: `S3 + CloudFront frontend stack for synthetic-supabase-app (${environment})`,
});

// Frontend depends on Lambda (needs apiGatewayDomain)
frontendStack.addDependency(lambdaStack);

// Apply common tags to all stacks
for (const [key, value] of Object.entries(commonTags)) {
  cdk.Tags.of(lambdaStack).add(key, value);
  cdk.Tags.of(frontendStack).add(key, value);
}
