#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const cdk = __importStar(require("aws-cdk-lib"));
const os = __importStar(require("os"));
const path = __importStar(require("path"));
const lambda_stack_1 = require("../lib/stacks/lambda-stack");
const frontend_stack_1 = require("../lib/stacks/frontend-stack");
const app = new cdk.App();
// Resolve environment from CDK context, falling back to preview-<whoami>
const environment = app.node.tryGetContext('environment') ??
    `preview-${os.userInfo().username}`;
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// ── Lambda Stack (API Gateway + Lambda functions) ──────────────────────────
const lambdaStack = new lambda_stack_1.LambdaStack(app, `SyntheticSupabaseApp-Lambda-${environment}`, { environment, env });
// ── Frontend Stack (S3 + CloudFront + /api/* proxy) ────────────────────────
// buildOutputPath is relative to infra/bin/ → go up two levels to repo root
const buildOutputPath = path.resolve(__dirname, '..', '..', 'dist');
const frontendStack = new frontend_stack_1.FrontendStack(app, `SyntheticSupabaseApp-Frontend-${environment}`, {
    environment,
    buildOutputPath,
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
});
// Frontend depends on Lambda so CDK orders deployment correctly
frontendStack.addDependency(lambdaStack);
// ── Tags ───────────────────────────────────────────────────────────────────
cdk.Tags.of(app).add('Project', 'SyntheticSupabaseApp');
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3Qiw2REFBeUQ7QUFDekQsaUVBQTZEO0FBRTdELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLHlFQUF5RTtBQUN6RSxNQUFNLFdBQVcsR0FDZCxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQXdCO0lBQzdELFdBQVcsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBRXRDLE1BQU0sR0FBRyxHQUFvQjtJQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7SUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztDQUN0RCxDQUFDO0FBRUYsOEVBQThFO0FBQzlFLE1BQU0sV0FBVyxHQUFHLElBQUksMEJBQVcsQ0FDakMsR0FBRyxFQUNILCtCQUErQixXQUFXLEVBQUUsRUFDNUMsRUFBRSxXQUFXLEVBQUUsR0FBRyxFQUFFLENBQ3JCLENBQUM7QUFFRiw4RUFBOEU7QUFDOUUsNEVBQTRFO0FBQzVFLE1BQU0sZUFBZSxHQUFHLElBQUksQ0FBQyxPQUFPLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsTUFBTSxDQUFDLENBQUM7QUFFcEUsTUFBTSxhQUFhLEdBQUcsSUFBSSw4QkFBYSxDQUNyQyxHQUFHLEVBQ0gsaUNBQWlDLFdBQVcsRUFBRSxFQUM5QztJQUNFLFdBQVc7SUFDWCxlQUFlO0lBQ2YsZ0JBQWdCLEVBQUUsV0FBVyxDQUFDLGdCQUFnQjtJQUM5QyxHQUFHO0NBQ0osQ0FDRixDQUFDO0FBRUYsZ0VBQWdFO0FBQ2hFLGFBQWEsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUM7QUFFekMsOEVBQThFO0FBQzlFLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxTQUFTLEVBQUUsc0JBQXNCLENBQUMsQ0FBQztBQUN4RCxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsV0FBVyxFQUFFLEtBQUssQ0FBQyxDQUFDO0FBQ3pDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxhQUFhLEVBQUUsV0FBVyxDQUFDLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IExhbWJkYVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9sYW1iZGEtc3RhY2snO1xuaW1wb3J0IHsgRnJvbnRlbmRTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvZnJvbnRlbmQtc3RhY2snO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBSZXNvbHZlIGVudmlyb25tZW50IGZyb20gQ0RLIGNvbnRleHQsIGZhbGxpbmcgYmFjayB0byBwcmV2aWV3LTx3aG9hbWk+XG5jb25zdCBlbnZpcm9ubWVudDogc3RyaW5nID1cbiAgKGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2Vudmlyb25tZW50JykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/P1xuICBgcHJldmlldy0ke29zLnVzZXJJbmZvKCkudXNlcm5hbWV9YDtcblxuY29uc3QgZW52OiBjZGsuRW52aXJvbm1lbnQgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OID8/ICd1cy1lYXN0LTEnLFxufTtcblxuLy8g4pSA4pSAIExhbWJkYSBTdGFjayAoQVBJIEdhdGV3YXkgKyBMYW1iZGEgZnVuY3Rpb25zKSDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNvbnN0IGxhbWJkYVN0YWNrID0gbmV3IExhbWJkYVN0YWNrKFxuICBhcHAsXG4gIGBTeW50aGV0aWNTdXBhYmFzZUFwcC1MYW1iZGEtJHtlbnZpcm9ubWVudH1gLFxuICB7IGVudmlyb25tZW50LCBlbnYgfVxuKTtcblxuLy8g4pSA4pSAIEZyb250ZW5kIFN0YWNrIChTMyArIENsb3VkRnJvbnQgKyAvYXBpLyogcHJveHkpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuLy8gYnVpbGRPdXRwdXRQYXRoIGlzIHJlbGF0aXZlIHRvIGluZnJhL2Jpbi8g4oaSIGdvIHVwIHR3byBsZXZlbHMgdG8gcmVwbyByb290XG5jb25zdCBidWlsZE91dHB1dFBhdGggPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnZGlzdCcpO1xuXG5jb25zdCBmcm9udGVuZFN0YWNrID0gbmV3IEZyb250ZW5kU3RhY2soXG4gIGFwcCxcbiAgYFN5bnRoZXRpY1N1cGFiYXNlQXBwLUZyb250ZW5kLSR7ZW52aXJvbm1lbnR9YCxcbiAge1xuICAgIGVudmlyb25tZW50LFxuICAgIGJ1aWxkT3V0cHV0UGF0aCxcbiAgICBhcGlHYXRld2F5RG9tYWluOiBsYW1iZGFTdGFjay5hcGlHYXRld2F5RG9tYWluLFxuICAgIGVudixcbiAgfVxuKTtcblxuLy8gRnJvbnRlbmQgZGVwZW5kcyBvbiBMYW1iZGEgc28gQ0RLIG9yZGVycyBkZXBsb3ltZW50IGNvcnJlY3RseVxuZnJvbnRlbmRTdGFjay5hZGREZXBlbmRlbmN5KGxhbWJkYVN0YWNrKTtcblxuLy8g4pSA4pSAIFRhZ3Mg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5jZGsuVGFncy5vZihhcHApLmFkZCgnUHJvamVjdCcsICdTeW50aGV0aWNTdXBhYmFzZUFwcCcpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50KTtcbiJdfQ==