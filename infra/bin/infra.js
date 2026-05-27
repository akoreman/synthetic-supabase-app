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
// Derive environment: CDK context > default "preview-<whoami>"
const environment = app.node.tryGetContext('environment') ??
    `preview-${os.userInfo().username}`;
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// -----------------------------------------------------------------------
// 1. Lambda Stack — API Gateway + Lambda functions
// -----------------------------------------------------------------------
const lambdaStack = new lambda_stack_1.LambdaStack(app, `LambdaStack-${environment}`, {
    environment,
    env,
});
// -----------------------------------------------------------------------
// 2. Frontend Stack — S3 + CloudFront + /api/* proxy to API Gateway
//    Depends on LambdaStack for the API Gateway domain.
// -----------------------------------------------------------------------
const frontendStack = new frontend_stack_1.FrontendStack(app, `FrontendStack-${environment}`, {
    environment,
    buildOutputPath: path.join(__dirname, '..', '..', 'dist'),
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
});
// FrontendStack depends on LambdaStack (explicit dependency)
frontendStack.addDependency(lambdaStack);
// -----------------------------------------------------------------------
// 3. Tags applied to all stacks
// -----------------------------------------------------------------------
const appName = 'synthetic-supabase-app';
cdk.Tags.of(app).add('Project', appName);
cdk.Tags.of(app).add('ManagedBy', 'CDK');
cdk.Tags.of(app).add('Environment', environment);
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3Qiw2REFBeUQ7QUFDekQsaUVBQTZEO0FBRTdELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLCtEQUErRDtBQUMvRCxNQUFNLFdBQVcsR0FDZCxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQVk7SUFDakQsV0FBVyxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUMsUUFBUSxFQUFFLENBQUM7QUFFdEMsTUFBTSxHQUFHLEdBQW9CO0lBQzNCLE9BQU8sRUFBRSxPQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQjtJQUN4QyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxrQkFBa0IsSUFBSSxXQUFXO0NBQ3RELENBQUM7QUFFRiwwRUFBMEU7QUFDMUUsbURBQW1EO0FBQ25ELDBFQUEwRTtBQUMxRSxNQUFNLFdBQVcsR0FBRyxJQUFJLDBCQUFXLENBQUMsR0FBRyxFQUFFLGVBQWUsV0FBVyxFQUFFLEVBQUU7SUFDckUsV0FBVztJQUNYLEdBQUc7Q0FDSixDQUFDLENBQUM7QUFFSCwwRUFBMEU7QUFDMUUsb0VBQW9FO0FBQ3BFLHdEQUF3RDtBQUN4RCwwRUFBMEU7QUFDMUUsTUFBTSxhQUFhLEdBQUcsSUFBSSw4QkFBYSxDQUFDLEdBQUcsRUFBRSxpQkFBaUIsV0FBVyxFQUFFLEVBQUU7SUFDM0UsV0FBVztJQUNYLGVBQWUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQztJQUN6RCxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO0lBQzlDLEdBQUc7Q0FDSixDQUFDLENBQUM7QUFFSCw2REFBNkQ7QUFDN0QsYUFBYSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUV6QywwRUFBMEU7QUFDMUUsZ0NBQWdDO0FBQ2hDLDBFQUEwRTtBQUMxRSxNQUFNLE9BQU8sR0FBRyx3QkFBd0IsQ0FBQztBQUN6QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxHQUFHLENBQUMsQ0FBQyxHQUFHLENBQUMsU0FBUyxFQUFFLE9BQU8sQ0FBQyxDQUFDO0FBQ3pDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxXQUFXLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDekMsR0FBRyxDQUFDLElBQUksQ0FBQyxFQUFFLENBQUMsR0FBRyxDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsRUFBRSxXQUFXLENBQUMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuaW1wb3J0IHsgTGFtYmRhU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL2xhbWJkYS1zdGFjayc7XG5pbXBvcnQgeyBGcm9udGVuZFN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9mcm9udGVuZC1zdGFjayc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIERlcml2ZSBlbnZpcm9ubWVudDogQ0RLIGNvbnRleHQgPiBkZWZhdWx0IFwicHJldmlldy08d2hvYW1pPlwiXG5jb25zdCBlbnZpcm9ubWVudCA9XG4gIChhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIGFzIHN0cmluZykgPz9cbiAgYHByZXZpZXctJHtvcy51c2VySW5mbygpLnVzZXJuYW1lfWA7XG5cbmNvbnN0IGVudjogY2RrLkVudmlyb25tZW50ID0ge1xuICBhY2NvdW50OiBwcm9jZXNzLmVudi5DREtfREVGQVVMVF9BQ0NPVU5ULFxuICByZWdpb246IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX1JFR0lPTiA/PyAndXMtZWFzdC0xJyxcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyAxLiBMYW1iZGEgU3RhY2sg4oCUIEFQSSBHYXRld2F5ICsgTGFtYmRhIGZ1bmN0aW9uc1xuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IGxhbWJkYVN0YWNrID0gbmV3IExhbWJkYVN0YWNrKGFwcCwgYExhbWJkYVN0YWNrLSR7ZW52aXJvbm1lbnR9YCwge1xuICBlbnZpcm9ubWVudCxcbiAgZW52LFxufSk7XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyAyLiBGcm9udGVuZCBTdGFjayDigJQgUzMgKyBDbG91ZEZyb250ICsgL2FwaS8qIHByb3h5IHRvIEFQSSBHYXRld2F5XG4vLyAgICBEZXBlbmRzIG9uIExhbWJkYVN0YWNrIGZvciB0aGUgQVBJIEdhdGV3YXkgZG9tYWluLlxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbmNvbnN0IGZyb250ZW5kU3RhY2sgPSBuZXcgRnJvbnRlbmRTdGFjayhhcHAsIGBGcm9udGVuZFN0YWNrLSR7ZW52aXJvbm1lbnR9YCwge1xuICBlbnZpcm9ubWVudCxcbiAgYnVpbGRPdXRwdXRQYXRoOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnZGlzdCcpLFxuICBhcGlHYXRld2F5RG9tYWluOiBsYW1iZGFTdGFjay5hcGlHYXRld2F5RG9tYWluLFxuICBlbnYsXG59KTtcblxuLy8gRnJvbnRlbmRTdGFjayBkZXBlbmRzIG9uIExhbWJkYVN0YWNrIChleHBsaWNpdCBkZXBlbmRlbmN5KVxuZnJvbnRlbmRTdGFjay5hZGREZXBlbmRlbmN5KGxhbWJkYVN0YWNrKTtcblxuLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIDMuIFRhZ3MgYXBwbGllZCB0byBhbGwgc3RhY2tzXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuY29uc3QgYXBwTmFtZSA9ICdzeW50aGV0aWMtc3VwYWJhc2UtYXBwJztcbmNkay5UYWdzLm9mKGFwcCkuYWRkKCdQcm9qZWN0JywgYXBwTmFtZSk7XG5jZGsuVGFncy5vZihhcHApLmFkZCgnTWFuYWdlZEJ5JywgJ0NESycpO1xuY2RrLlRhZ3Mub2YoYXBwKS5hZGQoJ0Vudmlyb25tZW50JywgZW52aXJvbm1lbnQpO1xuIl19