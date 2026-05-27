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
const lambda_stack_1 = require("../lib/stacks/lambda-stack");
const frontend_stack_1 = require("../lib/stacks/frontend-stack");
const app = new cdk.App();
// Resolve environment from CDK context, env var, or default to preview-<whoami>
const environment = app.node.tryGetContext('environment') ??
    process.env.ENVIRONMENT ??
    `preview-${os.userInfo().username}`;
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// ── 1. Lambda + API Gateway stack ──────────────────────────────────────────
const lambdaStack = new lambda_stack_1.LambdaStack(app, `LambdaStack-${environment}`, {
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
const frontendStack = new frontend_stack_1.FrontendStack(app, `FrontendStack-${environment}`, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDZEQUF5RDtBQUN6RCxpRUFBNkQ7QUFFN0QsTUFBTSxHQUFHLEdBQUcsSUFBSSxHQUFHLENBQUMsR0FBRyxFQUFFLENBQUM7QUFFMUIsZ0ZBQWdGO0FBQ2hGLE1BQU0sV0FBVyxHQUNmLEdBQUcsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLGFBQWEsQ0FBQztJQUNyQyxPQUFPLENBQUMsR0FBRyxDQUFDLFdBQVc7SUFDdkIsV0FBVyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUM7QUFFdEMsTUFBTSxHQUFHLEdBQW9CO0lBQzNCLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0NBQ3RELENBQUM7QUFFRiw4RUFBOEU7QUFDOUUsTUFBTSxXQUFXLEdBQUcsSUFBSSwwQkFBVyxDQUFDLEdBQUcsRUFBRSxlQUFlLFdBQVcsRUFBRSxFQUFFO0lBQ3JFLFdBQVc7SUFDWCxHQUFHO0lBQ0gsSUFBSSxFQUFFO1FBQ0osT0FBTyxFQUFFLHdCQUF3QjtRQUNqQyxTQUFTLEVBQUUsS0FBSztRQUNoQixXQUFXLEVBQUUsV0FBVztLQUN6QjtDQUNGLENBQUMsQ0FBQztBQUVILDhFQUE4RTtBQUM5RSwrRUFBK0U7QUFDL0UsTUFBTSxhQUFhLEdBQUcsSUFBSSw4QkFBYSxDQUFDLEdBQUcsRUFBRSxpQkFBaUIsV0FBVyxFQUFFLEVBQUU7SUFDM0UsV0FBVztJQUNYLGVBQWUsRUFBRSxTQUFTO0lBQzFCLGdCQUFnQixFQUFFLFdBQVcsQ0FBQyxnQkFBZ0I7SUFDOUMsR0FBRztJQUNILElBQUksRUFBRTtRQUNKLE9BQU8sRUFBRSx3QkFBd0I7UUFDakMsU0FBUyxFQUFFLEtBQUs7UUFDaEIsV0FBVyxFQUFFLFdBQVc7S0FDekI7Q0FDRixDQUFDLENBQUM7QUFFSCx3RUFBd0U7QUFDeEUsYUFBYSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUV6QywrRUFBK0U7QUFDL0UsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSx3QkFBd0IsQ0FBQyxDQUFDO0FBQzFELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDekMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxXQUFXLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgeyBMYW1iZGFTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvbGFtYmRhLXN0YWNrJztcbmltcG9ydCB7IEZyb250ZW5kU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL2Zyb250ZW5kLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gUmVzb2x2ZSBlbnZpcm9ubWVudCBmcm9tIENESyBjb250ZXh0LCBlbnYgdmFyLCBvciBkZWZhdWx0IHRvIHByZXZpZXctPHdob2FtaT5cbmNvbnN0IGVudmlyb25tZW50OiBzdHJpbmcgPVxuICBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpID8/XG4gIHByb2Nlc3MuZW52LkVOVklST05NRU5UID8/XG4gIGBwcmV2aWV3LSR7b3MudXNlckluZm8oKS51c2VybmFtZX1gO1xuXG5jb25zdCBlbnY6IGNkay5FbnZpcm9ubWVudCA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gPz8gJ3VzLWVhc3QtMScsXG59O1xuXG4vLyDilIDilIAgMS4gTGFtYmRhICsgQVBJIEdhdGV3YXkgc3RhY2sg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG5jb25zdCBsYW1iZGFTdGFjayA9IG5ldyBMYW1iZGFTdGFjayhhcHAsIGBMYW1iZGFTdGFjay0ke2Vudmlyb25tZW50fWAsIHtcbiAgZW52aXJvbm1lbnQsXG4gIGVudixcbiAgdGFnczoge1xuICAgIFByb2plY3Q6ICdzeW50aGV0aWMtc3VwYWJhc2UtYXBwJyxcbiAgICBNYW5hZ2VkQnk6ICdDREsnLFxuICAgIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbiAgfSxcbn0pO1xuXG4vLyDilIDilIAgMi4gRnJvbnRlbmQgc3RhY2sgKFMzICsgQ2xvdWRGcm9udCkg4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4vLyBEZXBlbmRzIG9uIExhbWJkYVN0YWNrIGZvciB0aGUgQVBJIEdhdGV3YXkgZG9tYWluIHVzZWQgYXMgQ2xvdWRGcm9udCBvcmlnaW4uXG5jb25zdCBmcm9udGVuZFN0YWNrID0gbmV3IEZyb250ZW5kU3RhY2soYXBwLCBgRnJvbnRlbmRTdGFjay0ke2Vudmlyb25tZW50fWAsIHtcbiAgZW52aXJvbm1lbnQsXG4gIGJ1aWxkT3V0cHV0UGF0aDogJy4uL2Rpc3QnLFxuICBhcGlHYXRld2F5RG9tYWluOiBsYW1iZGFTdGFjay5hcGlHYXRld2F5RG9tYWluLFxuICBlbnYsXG4gIHRhZ3M6IHtcbiAgICBQcm9qZWN0OiAnc3ludGhldGljLXN1cGFiYXNlLWFwcCcsXG4gICAgTWFuYWdlZEJ5OiAnQ0RLJyxcbiAgICBFbnZpcm9ubWVudDogZW52aXJvbm1lbnQsXG4gIH0sXG59KTtcblxuLy8gRXhwbGljaXQgZGVwZW5kZW5jeTogRnJvbnRlbmRTdGFjayBtdXN0IGJlIGRlcGxveWVkIGFmdGVyIExhbWJkYVN0YWNrXG5mcm9udGVuZFN0YWNrLmFkZERlcGVuZGVuY3kobGFtYmRhU3RhY2spO1xuXG4vLyDilIDilIAgMy4gU3RhY2stbGV2ZWwgdGFncyDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdQcm9qZWN0JywgJ3N5bnRoZXRpYy1zdXBhYmFzZS1hcHAnKTtcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdNYW5hZ2VkQnknLCAnQ0RLJyk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnRW52aXJvbm1lbnQnLCBlbnZpcm9ubWVudCk7XG4iXX0=