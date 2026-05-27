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
// Resolve environment from CDK context or default to preview-<whoami>
const environment = app.node.tryGetContext('environment') ??
    `preview-${os.userInfo().username}`;
// Tags applied to all stacks
const commonTags = {
    Project: 'synthetic-supabase-app',
    ManagedBy: 'CDK',
    Environment: environment,
};
// --- Lambda Stack (API Gateway + Lambda functions) ---
const lambdaStack = new lambda_stack_1.LambdaStack(app, `SyntheticSupabaseApp-Lambda-${environment}`, {
    environment,
    description: `Lambda + API Gateway stack for synthetic-supabase-app (${environment})`,
});
// --- Frontend Stack (S3 + CloudFront + /api/* proxy) ---
const frontendStack = new frontend_stack_1.FrontendStack(app, `SyntheticSupabaseApp-Frontend-${environment}`, {
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
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3Qiw2REFBeUQ7QUFDekQsaUVBQTZEO0FBRTdELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLHNFQUFzRTtBQUN0RSxNQUFNLFdBQVcsR0FDZCxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQXdCO0lBQzdELFdBQVcsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBRXRDLDZCQUE2QjtBQUM3QixNQUFNLFVBQVUsR0FBMkI7SUFDekMsT0FBTyxFQUFFLHdCQUF3QjtJQUNqQyxTQUFTLEVBQUUsS0FBSztJQUNoQixXQUFXLEVBQUUsV0FBVztDQUN6QixDQUFDO0FBRUYsd0RBQXdEO0FBQ3hELE1BQU0sV0FBVyxHQUFHLElBQUksMEJBQVcsQ0FBQyxHQUFHLEVBQUUsK0JBQStCLFdBQVcsRUFBRSxFQUFFO0lBQ3JGLFdBQVc7SUFDWCxXQUFXLEVBQUUsMERBQTBELFdBQVcsR0FBRztDQUN0RixDQUFDLENBQUM7QUFFSCwwREFBMEQ7QUFDMUQsTUFBTSxhQUFhLEdBQUcsSUFBSSw4QkFBYSxDQUFDLEdBQUcsRUFBRSxpQ0FBaUMsV0FBVyxFQUFFLEVBQUU7SUFDM0YsV0FBVztJQUNYLGVBQWUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQztJQUN6RCxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO0lBQzlDLFdBQVcsRUFBRSw4REFBOEQsV0FBVyxHQUFHO0NBQzFGLENBQUMsQ0FBQztBQUVILHNEQUFzRDtBQUN0RCxhQUFhLENBQUMsYUFBYSxDQUFDLFdBQVcsQ0FBQyxDQUFDO0FBRXpDLGtDQUFrQztBQUNsQyxLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxVQUFVLENBQUMsRUFBRSxDQUFDO0lBQ3RELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLFdBQVcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7SUFDekMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsYUFBYSxDQUFDLENBQUMsR0FBRyxDQUFDLEdBQUcsRUFBRSxLQUFLLENBQUMsQ0FBQztBQUM3QyxDQUFDIiwic291cmNlc0NvbnRlbnQiOlsiIyEvdXNyL2Jpbi9lbnYgbm9kZVxuaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIG9zIGZyb20gJ29zJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5pbXBvcnQgeyBMYW1iZGFTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvbGFtYmRhLXN0YWNrJztcbmltcG9ydCB7IEZyb250ZW5kU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL2Zyb250ZW5kLXN0YWNrJztcblxuY29uc3QgYXBwID0gbmV3IGNkay5BcHAoKTtcblxuLy8gUmVzb2x2ZSBlbnZpcm9ubWVudCBmcm9tIENESyBjb250ZXh0IG9yIGRlZmF1bHQgdG8gcHJldmlldy08d2hvYW1pPlxuY29uc3QgZW52aXJvbm1lbnQ6IHN0cmluZyA9XG4gIChhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPz9cbiAgYHByZXZpZXctJHtvcy51c2VySW5mbygpLnVzZXJuYW1lfWA7XG5cbi8vIFRhZ3MgYXBwbGllZCB0byBhbGwgc3RhY2tzXG5jb25zdCBjb21tb25UYWdzOiBSZWNvcmQ8c3RyaW5nLCBzdHJpbmc+ID0ge1xuICBQcm9qZWN0OiAnc3ludGhldGljLXN1cGFiYXNlLWFwcCcsXG4gIE1hbmFnZWRCeTogJ0NESycsXG4gIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbn07XG5cbi8vIC0tLSBMYW1iZGEgU3RhY2sgKEFQSSBHYXRld2F5ICsgTGFtYmRhIGZ1bmN0aW9ucykgLS0tXG5jb25zdCBsYW1iZGFTdGFjayA9IG5ldyBMYW1iZGFTdGFjayhhcHAsIGBTeW50aGV0aWNTdXBhYmFzZUFwcC1MYW1iZGEtJHtlbnZpcm9ubWVudH1gLCB7XG4gIGVudmlyb25tZW50LFxuICBkZXNjcmlwdGlvbjogYExhbWJkYSArIEFQSSBHYXRld2F5IHN0YWNrIGZvciBzeW50aGV0aWMtc3VwYWJhc2UtYXBwICgke2Vudmlyb25tZW50fSlgLFxufSk7XG5cbi8vIC0tLSBGcm9udGVuZCBTdGFjayAoUzMgKyBDbG91ZEZyb250ICsgL2FwaS8qIHByb3h5KSAtLS1cbmNvbnN0IGZyb250ZW5kU3RhY2sgPSBuZXcgRnJvbnRlbmRTdGFjayhhcHAsIGBTeW50aGV0aWNTdXBhYmFzZUFwcC1Gcm9udGVuZC0ke2Vudmlyb25tZW50fWAsIHtcbiAgZW52aXJvbm1lbnQsXG4gIGJ1aWxkT3V0cHV0UGF0aDogcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJ2Rpc3QnKSxcbiAgYXBpR2F0ZXdheURvbWFpbjogbGFtYmRhU3RhY2suYXBpR2F0ZXdheURvbWFpbixcbiAgZGVzY3JpcHRpb246IGBTMyArIENsb3VkRnJvbnQgZnJvbnRlbmQgc3RhY2sgZm9yIHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAgKCR7ZW52aXJvbm1lbnR9KWAsXG59KTtcblxuLy8gRnJvbnRlbmQgZGVwZW5kcyBvbiBMYW1iZGEgKG5lZWRzIGFwaUdhdGV3YXlEb21haW4pXG5mcm9udGVuZFN0YWNrLmFkZERlcGVuZGVuY3kobGFtYmRhU3RhY2spO1xuXG4vLyBBcHBseSBjb21tb24gdGFncyB0byBhbGwgc3RhY2tzXG5mb3IgKGNvbnN0IFtrZXksIHZhbHVlXSBvZiBPYmplY3QuZW50cmllcyhjb21tb25UYWdzKSkge1xuICBjZGsuVGFncy5vZihsYW1iZGFTdGFjaykuYWRkKGtleSwgdmFsdWUpO1xuICBjZGsuVGFncy5vZihmcm9udGVuZFN0YWNrKS5hZGQoa2V5LCB2YWx1ZSk7XG59XG4iXX0=