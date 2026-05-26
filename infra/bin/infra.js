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
// Resolve environment from CDK context, env var, or default to preview-<whoami>
const environment = app.node.tryGetContext('environment') ??
    process.env['ENVIRONMENT'] ??
    `preview-${os.userInfo().username}`;
const env = {
    account: process.env['CDK_DEFAULT_ACCOUNT'],
    region: process.env['CDK_DEFAULT_REGION'] ?? 'us-east-1',
};
const tags = {
    Project: 'SyntheticSupabaseApp',
    ManagedBy: 'CDK',
    Environment: environment,
};
// -------------------------------------------------------------------------
// 1. Lambda Stack — API Gateway + Lambda functions
// -------------------------------------------------------------------------
const lambdaStack = new lambda_stack_1.LambdaStack(app, `SyntheticSupabaseApp-Lambda-${environment}`, {
    environment,
    env,
    tags,
});
// -------------------------------------------------------------------------
// 2. Frontend Stack — S3 + CloudFront + /api/* proxy to API Gateway
//    Depends on LambdaStack for apiGatewayDomain
// -------------------------------------------------------------------------
const frontendStack = new frontend_stack_1.FrontendStack(app, `SyntheticSupabaseApp-Frontend-${environment}`, {
    environment,
    // Resolve dist/ relative to the repo root (one level above infra/)
    buildOutputPath: path.join(__dirname, '..', '..', 'dist'),
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
    tags,
});
// Frontend explicitly depends on Lambda (API Gateway must exist first)
frontendStack.addDependency(lambdaStack);
// Apply tags to every resource in both stacks
Object.entries(tags).forEach(([key, value]) => {
    cdk.Tags.of(lambdaStack).add(key, value);
    cdk.Tags.of(frontendStack).add(key, value);
});
app.synth();
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDJDQUE2QjtBQUM3Qiw2REFBeUQ7QUFDekQsaUVBQTZEO0FBRTdELE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLGdGQUFnRjtBQUNoRixNQUFNLFdBQVcsR0FDZCxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQXdCO0lBQzdELE9BQU8sQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDO0lBQzFCLFdBQVcsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBRXRDLE1BQU0sR0FBRyxHQUFvQjtJQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxxQkFBcUIsQ0FBQztJQUMzQyxNQUFNLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxvQkFBb0IsQ0FBQyxJQUFJLFdBQVc7Q0FDekQsQ0FBQztBQUVGLE1BQU0sSUFBSSxHQUEyQjtJQUNuQyxPQUFPLEVBQUUsc0JBQXNCO0lBQy9CLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFdBQVcsRUFBRSxXQUFXO0NBQ3pCLENBQUM7QUFFRiw0RUFBNEU7QUFDNUUsbURBQW1EO0FBQ25ELDRFQUE0RTtBQUM1RSxNQUFNLFdBQVcsR0FBRyxJQUFJLDBCQUFXLENBQ2pDLEdBQUcsRUFDSCwrQkFBK0IsV0FBVyxFQUFFLEVBQzVDO0lBQ0UsV0FBVztJQUNYLEdBQUc7SUFDSCxJQUFJO0NBQ0wsQ0FDRixDQUFDO0FBRUYsNEVBQTRFO0FBQzVFLG9FQUFvRTtBQUNwRSxpREFBaUQ7QUFDakQsNEVBQTRFO0FBQzVFLE1BQU0sYUFBYSxHQUFHLElBQUksOEJBQWEsQ0FDckMsR0FBRyxFQUNILGlDQUFpQyxXQUFXLEVBQUUsRUFDOUM7SUFDRSxXQUFXO0lBQ1gsbUVBQW1FO0lBQ25FLGVBQWUsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLE1BQU0sQ0FBQztJQUN6RCxnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO0lBQzlDLEdBQUc7SUFDSCxJQUFJO0NBQ0wsQ0FDRixDQUFDO0FBRUYsdUVBQXVFO0FBQ3ZFLGFBQWEsQ0FBQyxhQUFhLENBQUMsV0FBVyxDQUFDLENBQUM7QUFFekMsOENBQThDO0FBQzlDLE1BQU0sQ0FBQyxPQUFPLENBQUMsSUFBSSxDQUFDLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLEVBQUUsRUFBRTtJQUM1QyxHQUFHLENBQUMsSUFBSSxDQUFDLEVBQUUsQ0FBQyxXQUFXLENBQUMsQ0FBQyxHQUFHLENBQUMsR0FBRyxFQUFFLEtBQUssQ0FBQyxDQUFDO0lBQ3pDLEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLGFBQWEsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDN0MsQ0FBQyxDQUFDLENBQUM7QUFFSCxHQUFHLENBQUMsS0FBSyxFQUFFLENBQUMiLCJzb3VyY2VzQ29udGVudCI6WyIjIS91c3IvYmluL2VudiBub2RlXG5pbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgb3MgZnJvbSAnb3MnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcbmltcG9ydCB7IExhbWJkYVN0YWNrIH0gZnJvbSAnLi4vbGliL3N0YWNrcy9sYW1iZGEtc3RhY2snO1xuaW1wb3J0IHsgRnJvbnRlbmRTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvZnJvbnRlbmQtc3RhY2snO1xuXG5jb25zdCBhcHAgPSBuZXcgY2RrLkFwcCgpO1xuXG4vLyBSZXNvbHZlIGVudmlyb25tZW50IGZyb20gQ0RLIGNvbnRleHQsIGVudiB2YXIsIG9yIGRlZmF1bHQgdG8gcHJldmlldy08d2hvYW1pPlxuY29uc3QgZW52aXJvbm1lbnQ6IHN0cmluZyA9XG4gIChhcHAubm9kZS50cnlHZXRDb250ZXh0KCdlbnZpcm9ubWVudCcpIGFzIHN0cmluZyB8IHVuZGVmaW5lZCkgPz9cbiAgcHJvY2Vzcy5lbnZbJ0VOVklST05NRU5UJ10gPz9cbiAgYHByZXZpZXctJHtvcy51c2VySW5mbygpLnVzZXJuYW1lfWA7XG5cbmNvbnN0IGVudjogY2RrLkVudmlyb25tZW50ID0ge1xuICBhY2NvdW50OiBwcm9jZXNzLmVudlsnQ0RLX0RFRkFVTFRfQUNDT1VOVCddLFxuICByZWdpb246IHByb2Nlc3MuZW52WydDREtfREVGQVVMVF9SRUdJT04nXSA/PyAndXMtZWFzdC0xJyxcbn07XG5cbmNvbnN0IHRhZ3M6IFJlY29yZDxzdHJpbmcsIHN0cmluZz4gPSB7XG4gIFByb2plY3Q6ICdTeW50aGV0aWNTdXBhYmFzZUFwcCcsXG4gIE1hbmFnZWRCeTogJ0NESycsXG4gIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbn07XG5cbi8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbi8vIDEuIExhbWJkYSBTdGFjayDigJQgQVBJIEdhdGV3YXkgKyBMYW1iZGEgZnVuY3Rpb25zXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zdCBsYW1iZGFTdGFjayA9IG5ldyBMYW1iZGFTdGFjayhcbiAgYXBwLFxuICBgU3ludGhldGljU3VwYWJhc2VBcHAtTGFtYmRhLSR7ZW52aXJvbm1lbnR9YCxcbiAge1xuICAgIGVudmlyb25tZW50LFxuICAgIGVudixcbiAgICB0YWdzLFxuICB9XG4pO1xuXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4vLyAyLiBGcm9udGVuZCBTdGFjayDigJQgUzMgKyBDbG91ZEZyb250ICsgL2FwaS8qIHByb3h5IHRvIEFQSSBHYXRld2F5XG4vLyAgICBEZXBlbmRzIG9uIExhbWJkYVN0YWNrIGZvciBhcGlHYXRld2F5RG9tYWluXG4vLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG5jb25zdCBmcm9udGVuZFN0YWNrID0gbmV3IEZyb250ZW5kU3RhY2soXG4gIGFwcCxcbiAgYFN5bnRoZXRpY1N1cGFiYXNlQXBwLUZyb250ZW5kLSR7ZW52aXJvbm1lbnR9YCxcbiAge1xuICAgIGVudmlyb25tZW50LFxuICAgIC8vIFJlc29sdmUgZGlzdC8gcmVsYXRpdmUgdG8gdGhlIHJlcG8gcm9vdCAob25lIGxldmVsIGFib3ZlIGluZnJhLylcbiAgICBidWlsZE91dHB1dFBhdGg6IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICdkaXN0JyksXG4gICAgYXBpR2F0ZXdheURvbWFpbjogbGFtYmRhU3RhY2suYXBpR2F0ZXdheURvbWFpbixcbiAgICBlbnYsXG4gICAgdGFncyxcbiAgfVxuKTtcblxuLy8gRnJvbnRlbmQgZXhwbGljaXRseSBkZXBlbmRzIG9uIExhbWJkYSAoQVBJIEdhdGV3YXkgbXVzdCBleGlzdCBmaXJzdClcbmZyb250ZW5kU3RhY2suYWRkRGVwZW5kZW5jeShsYW1iZGFTdGFjayk7XG5cbi8vIEFwcGx5IHRhZ3MgdG8gZXZlcnkgcmVzb3VyY2UgaW4gYm90aCBzdGFja3Ncbk9iamVjdC5lbnRyaWVzKHRhZ3MpLmZvckVhY2goKFtrZXksIHZhbHVlXSkgPT4ge1xuICBjZGsuVGFncy5vZihsYW1iZGFTdGFjaykuYWRkKGtleSwgdmFsdWUpO1xuICBjZGsuVGFncy5vZihmcm9udGVuZFN0YWNrKS5hZGQoa2V5LCB2YWx1ZSk7XG59KTtcblxuYXBwLnN5bnRoKCk7XG4iXX0=