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
const path = __importStar(require("path"));
const app = new cdk.App();
// Resolve environment from CDK context, or default to preview-<whoami>
const environment = app.node.tryGetContext('environment') ??
    `preview-${os.userInfo().username}`;
const env = {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION ?? 'us-east-1',
};
// 1. Lambda stack (API Gateway + Lambda functions)
const lambdaStack = new lambda_stack_1.LambdaStack(app, `App-${environment}-Lambda`, {
    environment,
    env,
});
// 2. Frontend stack (S3 + CloudFront + /api/* proxy to API Gateway)
//    Build output is at <repo-root>/dist relative to this bin file
const buildOutputPath = path.join(__dirname, '..', '..', 'dist');
const frontendStack = new frontend_stack_1.FrontendStack(app, `App-${environment}-Frontend`, {
    environment,
    buildOutputPath,
    apiGatewayDomain: lambdaStack.apiGatewayDomain,
    env,
});
// Frontend depends on Lambda stack being deployed first (needs apiGatewayDomain)
frontendStack.addDependency(lambdaStack);
// 3. Tags applied to all resources in both stacks
const tags = {
    Project: 'App',
    ManagedBy: 'CDK',
    Environment: environment,
};
for (const [key, value] of Object.entries(tags)) {
    cdk.Tags.of(app).add(key, value);
}
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiaW5mcmEuanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJpbmZyYS50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFDQSxpREFBbUM7QUFDbkMsdUNBQXlCO0FBQ3pCLDZEQUF5RDtBQUN6RCxpRUFBNkQ7QUFDN0QsMkNBQTZCO0FBRTdCLE1BQU0sR0FBRyxHQUFHLElBQUksR0FBRyxDQUFDLEdBQUcsRUFBRSxDQUFDO0FBRTFCLHVFQUF1RTtBQUN2RSxNQUFNLFdBQVcsR0FDZCxHQUFHLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxhQUFhLENBQXdCO0lBQzdELFdBQVcsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDLFFBQVEsRUFBRSxDQUFDO0FBRXRDLE1BQU0sR0FBRyxHQUFvQjtJQUMzQixPQUFPLEVBQUUsT0FBTyxDQUFDLEdBQUcsQ0FBQyxtQkFBbUI7SUFDeEMsTUFBTSxFQUFFLE9BQU8sQ0FBQyxHQUFHLENBQUMsa0JBQWtCLElBQUksV0FBVztDQUN0RCxDQUFDO0FBRUYsbURBQW1EO0FBQ25ELE1BQU0sV0FBVyxHQUFHLElBQUksMEJBQVcsQ0FBQyxHQUFHLEVBQUUsT0FBTyxXQUFXLFNBQVMsRUFBRTtJQUNwRSxXQUFXO0lBQ1gsR0FBRztDQUNKLENBQUMsQ0FBQztBQUVILG9FQUFvRTtBQUNwRSxtRUFBbUU7QUFDbkUsTUFBTSxlQUFlLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxNQUFNLENBQUMsQ0FBQztBQUVqRSxNQUFNLGFBQWEsR0FBRyxJQUFJLDhCQUFhLENBQUMsR0FBRyxFQUFFLE9BQU8sV0FBVyxXQUFXLEVBQUU7SUFDMUUsV0FBVztJQUNYLGVBQWU7SUFDZixnQkFBZ0IsRUFBRSxXQUFXLENBQUMsZ0JBQWdCO0lBQzlDLEdBQUc7Q0FDSixDQUFDLENBQUM7QUFFSCxpRkFBaUY7QUFDakYsYUFBYSxDQUFDLGFBQWEsQ0FBQyxXQUFXLENBQUMsQ0FBQztBQUV6QyxrREFBa0Q7QUFDbEQsTUFBTSxJQUFJLEdBQUc7SUFDWCxPQUFPLEVBQUUsS0FBSztJQUNkLFNBQVMsRUFBRSxLQUFLO0lBQ2hCLFdBQVcsRUFBRSxXQUFXO0NBQ3pCLENBQUM7QUFFRixLQUFLLE1BQU0sQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLElBQUksTUFBTSxDQUFDLE9BQU8sQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDO0lBQ2hELEdBQUcsQ0FBQyxJQUFJLENBQUMsRUFBRSxDQUFDLEdBQUcsQ0FBQyxDQUFDLEdBQUcsQ0FBQyxHQUFHLEVBQUUsS0FBSyxDQUFDLENBQUM7QUFDbkMsQ0FBQyIsInNvdXJjZXNDb250ZW50IjpbIiMhL3Vzci9iaW4vZW52IG5vZGVcbmltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBvcyBmcm9tICdvcyc7XG5pbXBvcnQgeyBMYW1iZGFTdGFjayB9IGZyb20gJy4uL2xpYi9zdGFja3MvbGFtYmRhLXN0YWNrJztcbmltcG9ydCB7IEZyb250ZW5kU3RhY2sgfSBmcm9tICcuLi9saWIvc3RhY2tzL2Zyb250ZW5kLXN0YWNrJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmNvbnN0IGFwcCA9IG5ldyBjZGsuQXBwKCk7XG5cbi8vIFJlc29sdmUgZW52aXJvbm1lbnQgZnJvbSBDREsgY29udGV4dCwgb3IgZGVmYXVsdCB0byBwcmV2aWV3LTx3aG9hbWk+XG5jb25zdCBlbnZpcm9ubWVudDogc3RyaW5nID1cbiAgKGFwcC5ub2RlLnRyeUdldENvbnRleHQoJ2Vudmlyb25tZW50JykgYXMgc3RyaW5nIHwgdW5kZWZpbmVkKSA/P1xuICBgcHJldmlldy0ke29zLnVzZXJJbmZvKCkudXNlcm5hbWV9YDtcblxuY29uc3QgZW52OiBjZGsuRW52aXJvbm1lbnQgPSB7XG4gIGFjY291bnQ6IHByb2Nlc3MuZW52LkNES19ERUZBVUxUX0FDQ09VTlQsXG4gIHJlZ2lvbjogcHJvY2Vzcy5lbnYuQ0RLX0RFRkFVTFRfUkVHSU9OID8/ICd1cy1lYXN0LTEnLFxufTtcblxuLy8gMS4gTGFtYmRhIHN0YWNrIChBUEkgR2F0ZXdheSArIExhbWJkYSBmdW5jdGlvbnMpXG5jb25zdCBsYW1iZGFTdGFjayA9IG5ldyBMYW1iZGFTdGFjayhhcHAsIGBBcHAtJHtlbnZpcm9ubWVudH0tTGFtYmRhYCwge1xuICBlbnZpcm9ubWVudCxcbiAgZW52LFxufSk7XG5cbi8vIDIuIEZyb250ZW5kIHN0YWNrIChTMyArIENsb3VkRnJvbnQgKyAvYXBpLyogcHJveHkgdG8gQVBJIEdhdGV3YXkpXG4vLyAgICBCdWlsZCBvdXRwdXQgaXMgYXQgPHJlcG8tcm9vdD4vZGlzdCByZWxhdGl2ZSB0byB0aGlzIGJpbiBmaWxlXG5jb25zdCBidWlsZE91dHB1dFBhdGggPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnZGlzdCcpO1xuXG5jb25zdCBmcm9udGVuZFN0YWNrID0gbmV3IEZyb250ZW5kU3RhY2soYXBwLCBgQXBwLSR7ZW52aXJvbm1lbnR9LUZyb250ZW5kYCwge1xuICBlbnZpcm9ubWVudCxcbiAgYnVpbGRPdXRwdXRQYXRoLFxuICBhcGlHYXRld2F5RG9tYWluOiBsYW1iZGFTdGFjay5hcGlHYXRld2F5RG9tYWluLFxuICBlbnYsXG59KTtcblxuLy8gRnJvbnRlbmQgZGVwZW5kcyBvbiBMYW1iZGEgc3RhY2sgYmVpbmcgZGVwbG95ZWQgZmlyc3QgKG5lZWRzIGFwaUdhdGV3YXlEb21haW4pXG5mcm9udGVuZFN0YWNrLmFkZERlcGVuZGVuY3kobGFtYmRhU3RhY2spO1xuXG4vLyAzLiBUYWdzIGFwcGxpZWQgdG8gYWxsIHJlc291cmNlcyBpbiBib3RoIHN0YWNrc1xuY29uc3QgdGFncyA9IHtcbiAgUHJvamVjdDogJ0FwcCcsXG4gIE1hbmFnZWRCeTogJ0NESycsXG4gIEVudmlyb25tZW50OiBlbnZpcm9ubWVudCxcbn07XG5cbmZvciAoY29uc3QgW2tleSwgdmFsdWVdIG9mIE9iamVjdC5lbnRyaWVzKHRhZ3MpKSB7XG4gIGNkay5UYWdzLm9mKGFwcCkuYWRkKGtleSwgdmFsdWUpO1xufVxuIl19