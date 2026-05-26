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
require("source-map-support/register");
const cdk = __importStar(require("aws-cdk-lib"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const lambda_stack_1 = require("../lib/stacks/lambda-stack");
const frontend_stack_1 = require("../lib/stacks/frontend-stack");
const app = new cdk.App();
// Resolve environment: CDK context -c environment=<env>, else preview-<whoami>
const environment = app.node.tryGetContext('environment') ?? `preview-${os.userInfo().username}`;
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// 1. Lambda stack (API Gateway + Lambda functions)
const lambdaStack = new lambda_stack_1.LambdaStack(app, `LambdaStack-${environment}`, {
    environment,
    env,
});
// 2. Frontend stack (S3 + CloudFront + /api/* proxy to API Gateway)
//    Build output path is relative to this bin/ file → repo root dist/
const buildOutputPath = path.join(__dirname, '..', '..', 'dist');
const frontendStack = new frontend_stack_1.FrontendStack(app, `FrontendStack-${environment}`, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSx1Q0FBcUM7QUFDckMsaURBQW1DO0FBQ25DLDJDQUE2QjtBQUM3Qix1Q0FBeUI7QUFDekIsNkRBQXlEO0FBQ3pELGlFQUE2RDtBQUU3RCxNQUFNLEdBQUcsR0FBRyxJQUFJLEdBQUcsQ0FBQyxHQUFHLEVBQUUsQ0FBQztBQUUxQiwrRUFBK0U7QUFDL0UsTUFBTSxXQUFXLEdBQ2YsR0FBRyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsYUFBYSxDQUFDLElBQUksV0FBVyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUM7QUFFL0UsTUFBTSxHQUFHLEdBQW9CO0lBQzNCLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0NBQ3RELENBQUM7QUFFRixtREFBbUQ7QUFDbkQsTUFBTSxXQUFXLEdBQUcsSUFBSSwwQkFBVyxDQUFDLEdBQUcsRUFBRSxlQUFlLFdBQVcsRUFBRSxFQUFFO0lBQ3JFLFdBQVc7SUFDWCxHQUFHO0NBQ0osQ0FBQyxDQUFDO0FBRUgsb0VBQW9FO0FBQ3BFLHVFQUF1RTtBQUN2RSxNQUFNLGVBQWUsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQyxDQUFDO0FBRWpFLE1BQU0sYUFBYSxHQUFHLElBQUksOEJBQWEsQ0FBQyxHQUFHLEVBQUUsaUJBQWlCLFdBQVcsRUFBRSxFQUFFO0lBQzNFLFdBQVc7SUFDWCxlQUFlO0lBQ2YsZ0JBQWdCLEVBQUUsV0FBVyxDQUFDLGdCQUFnQjtJQUM5QyxHQUFHO0NBQ0osQ0FBQyxDQUFDO0FBRUgsMEVBQTBFO0FBQzFFLGFBQWEsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUM7QUFFekMsc0VBQXNFO0FBQ3RFLCtDQUErQztBQUMvQyxzRUFBc0U7QUFDdEUsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLFNBQVMsRUFBRSx3QkFBd0IsQ0FBQyxDQUFDO0FBQzFELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDekMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxXQUFXLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAnc291cmNlLW1hcC1zdXBwb3J0L3JlZ2lzdGVyJztcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0IHsgTGFtYmRhU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL2xhbWJkYS1zdGFjayc7XG5pbXBvcnQgeyBGcm9udGVuZFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9mcm9udGVuZC1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIFJlc29sdmUgZW52aXJvbm1lbnQ6IENESyBjb250ZXh0IC1jIGVudmlyb25tZW50PTxlbnY+LCBlbHNlIHByZXZpZXctPHdob2FtaT5cbmNvbnN0IGVudmlyb25tZW50OiBzdHJpbmcgPVxuICBhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpID8/IGBwcmV2aWV3LSR7b3MudXNlckluZm8oKS51c2VybmFtZX1gO1xuXG5jb25zdCBlbnY6IGNkay5FbnZpcm9ubWVudCA9IHtcbiAgYWNjb3VudDogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfQUNDT1VOVCxcbiAgcmVnaW9uOiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9SRUdJT04gPz8gJ3VzLWVhc3QtMScsXG59O1xuXG4vLyAxLiBMYW1iZGEgc3RhY2sgKEFQSSBHYXRld2F5ICsgTGFtYmRhIGZ1bmN0aW9ucylcbmNvbnN0IGxhbWJkYVN0YWNrID0gbmV3IExhbWJkYVN0YWNrKGFwcCwgYExhbWJkYVN0YWNrLSR7ZW52aXJvbm1lbnR9YCwge1xuICBlbnZpcm9ubWVudCxcbiAgZW52LFxufSk7XG5cbi8vIDIuIEZyb250ZW5kIHN0YWNrIChTMyArIENsb3VkRnJvbnQgKyAvYXBpLyogcHJveHkgdG8gQVBJIEdhdGV3YXkpXG4vLyAgICBCdWlsZCBvdXRwdXQgcGF0aCBpcyByZWxhdGl2ZSB0byB0aGlzIGJpbi8gZmlsZSDihpIgcmVwbyByb290IGRpc3QvXG5jb25zdCBidWlsZE91dHB1dFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnZGlzdCcpO1xuXG5jb25zdCBmcm9udGVuZFN0YWNrID0gbmV3IEZyb250ZW5kU3RhY2soYXBwLCBgRnJvbnRlbmRTdGFjay0ke2Vudmlyb25tZW50fWAsIHtcbiAgZW52aXJvbm1lbnQsXG4gIGJ1aWxkT3V0cHV0UGF0aCxcbiAgYXBpR2F0ZXdheURvbWFpbjogbGFtYmRhU3RhY2suYXBpR2F0ZXdheURvbWFpbixcbiAgZW52LFxufSk7XG5cbi8vIEZyb250ZW5kIGRlcGVuZHMgb24gTGFtYmRhIChuZWVkcyB0aGUgQVBJIEdhdGV3YXkgZG9tYWluIGF0IHN5bnRoIHRpbWUpXG5mcm9udGVuZFN0YWNrLmFkZERlcGVuZGVuY3kobGFtYmRhU3RhY2spO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyBUYWdzIGFwcGxpZWQgdG8gYWxsIHJlc291cmNlcyBpbiBib3RoIHN0YWNrc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ1Byb2plY3QnLCAnc3ludGhldGljLXN1cGFiYXNlLWFwcCcpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ01hbmFnZWRCeScsICdDREsnKTtcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdFbnZpcm9ubWVudCcsIGVudmlyb25tZW50KTtcbiJdfQ==