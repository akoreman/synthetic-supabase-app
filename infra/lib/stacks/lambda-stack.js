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
exports.LambdaStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const lambda = __importStar(require("aws-cdk-lib/aws-lambda"));
const aws_lambda_nodejs_1 = require("aws-cdk-lib/aws-lambda-nodejs");
const apigateway = __importStar(require("aws-cdk-lib/aws-apigateway"));
const secretsmanager = __importStar(require("aws-cdk-lib/aws-secretsmanager"));
const iam = __importStar(require("aws-cdk-lib/aws-iam"));
const logs = __importStar(require("aws-cdk-lib/aws-logs"));
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
class LambdaStack extends cdk.Stack {
    api;
    apiGatewayDomain;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment } = props;
        const appName = 'synthetic-supabase-app';
        // The monorepo root is one level above the infra/ directory.
        // NodejsFunction requires entry to be under projectRoot, so we set
        // projectRoot to the repo root so it can reach lambda/ sibling directory.
        const repoRoot = path.join(__dirname, '..', '..', '..');
        // -----------------------------------------------------------------------
        // 1. Reference the Secrets Manager secret (created outside this stack)
        // -----------------------------------------------------------------------
        const appSecret = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `${appName}/${environment}/secrets`);
        // -----------------------------------------------------------------------
        // 2. Lambda execution role
        //    - AWSLambdaBasicExecutionRole (CloudWatch Logs)
        //    - Secrets Manager read access for the app secret
        // -----------------------------------------------------------------------
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant read access to the secret
        appSecret.grantRead(lambdaRole);
        // -----------------------------------------------------------------------
        // 3. Log retention: 10 years for prod, 1 week for non-prod
        // -----------------------------------------------------------------------
        const logRetention = environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK;
        // -----------------------------------------------------------------------
        // 4. API Gateway RestApi
        //    - Stage name: "api"
        //    - CloudWatch access logging
        //    - Default method throttling (rate 100, burst 200)
        //    - No CORS — CloudFront proxies /api/* to avoid cross-origin issues
        // -----------------------------------------------------------------------
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
            retention: logRetention,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.api = new apigateway.RestApi(this, 'RestApi', {
            restApiName: `${appName}-${environment}`,
            description: `API for ${appName} (${environment})`,
            deployOptions: {
                stageName: 'api',
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: false,
            },
            // No defaultCorsPreflightOptions — CloudFront proxies /api/*
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // -----------------------------------------------------------------------
        // 5. Auto-discover Lambda functions from the lambda/ directory
        //    Each sub-directory is treated as one function.
        // -----------------------------------------------------------------------
        const lambdaBaseDir = path.join(repoRoot, 'lambda');
        const functionDirs = fs
            .readdirSync(lambdaBaseDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // -----------------------------------------------------------------------
        // 6. Create a NodejsFunction + API Gateway resource for every function
        // -----------------------------------------------------------------------
        for (const fnDir of functionDirs) {
            // Convert directory name to a valid logical ID (PascalCase)
            const logicalId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            const fnEntry = path.join(lambdaBaseDir, fnDir, 'index.ts');
            // Explicit log group per function (avoids deprecated logRetention prop)
            const fnLogGroup = new logs.LogGroup(this, `${logicalId}LogGroup`, {
                logGroupName: `/aws/lambda/${appName}-${environment}-${fnDir}`,
                retention: logRetention,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${logicalId}Function`, {
                functionName: `${appName}-${environment}-${fnDir}`,
                entry: fnEntry,
                handler: 'handler',
                runtime: lambda.Runtime.NODEJS_LATEST,
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                logGroup: fnLogGroup,
                environment: {
                    SECRETS_ARN: appSecret.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                bundling: {
                    minify: true,
                    sourceMap: false,
                    target: 'es2022',
                    // Exclude AWS SDK v3 — available in the Lambda runtime
                    externalModules: ['@aws-sdk/*'],
                },
                // projectRoot must contain the entry file — repo root houses lambda/
                projectRoot: repoRoot,
                // Use the repo-root package-lock.json so CDK picks npm as package manager
                depsLockFilePath: path.join(repoRoot, 'package-lock.json'),
            });
            // API Gateway resource: /<fnDir>
            const resource = this.api.root.addResource(fnDir);
            // Support both GET and POST
            const lambdaIntegration = new apigateway.LambdaIntegration(fn, {
                requestTemplates: { 'application/json': '{ "statusCode": "200" }' },
            });
            resource.addMethod('GET', lambdaIntegration);
            resource.addMethod('POST', lambdaIntegration);
        }
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQzlCLE1BQU0sT0FBTyxHQUFHLHdCQUF3QixDQUFDO1FBRXpDLDZEQUE2RDtRQUM3RCxtRUFBbUU7UUFDbkUsMEVBQTBFO1FBQzFFLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFFeEQsMEVBQTBFO1FBQzFFLHVFQUF1RTtRQUN2RSwwRUFBMEU7UUFDMUUsTUFBTSxTQUFTLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDdEQsSUFBSSxFQUNKLFlBQVksRUFDWixHQUFHLE9BQU8sSUFBSSxXQUFXLFVBQVUsQ0FDcEMsQ0FBQztRQUVGLDBFQUEwRTtRQUMxRSwyQkFBMkI7UUFDM0IscURBQXFEO1FBQ3JELHNEQUFzRDtRQUN0RCwwRUFBMEU7UUFDMUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZ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QWdCLEVBQUUsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsbUJBQW1CLENBQUM7YUFDM0QsQ0FBQyxDQUFDO1lBRUgsaUNBQWlDO1lBQ2pDLE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxHQUFHLENBQUMsSUFBSSxDQUFDLFdBQVcsQ0FBQyxLQUFLLENBQUMsQ0FBQztZQUVsRCw0QkFBNEI7WUFDNUIsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEVBQUU7Z0JBQzdELGdCQUFnQixFQUFFLEVBQUUsa0JBQWtCLEVBQUUseUJBQXlCLEVBQUU7YUFDcEUsQ0FBQyxDQUFDO1lBRUgsUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsaUJBQWlCLENBQUMsQ0FBQztZQUM3QyxRQUFRLENBQUMsU0FBUyxDQUFDLE1BQU0sRUFBRSxpQkFBaUIsQ0FBQyxDQUFDO1FBQ2hELENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFsSkQsa0NBa0pDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpR2F0ZXdheURvbWFpbjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50IH0gPSBwcm9wcztcbiAgICBjb25zdCBhcHBOYW1lID0gJ3N5bnRoZXRpYy1zdXBhYmFzZS1hcHAnO1xuXG4gICAgLy8gVGhlIG1vbm9yZXBvIHJvb3QgaXMgb25lIGxldmVsIGFib3ZlIHRoZSBpbmZyYS8gZGlyZWN0b3J5LlxuICAgIC8vIE5vZGVqc0Z1bmN0aW9uIHJlcXVpcmVzIGVudHJ5IHRvIGJlIHVuZGVyIHByb2plY3RSb290LCBzbyB3ZSBzZXRcbiAgICAvLyBwcm9qZWN0Um9vdCB0byB0aGUgcmVwbyByb290IHNvIGl0IGNhbiByZWFjaCBsYW1iZGEvIHNpYmxpbmcgZGlyZWN0b3J5LlxuICAgIGNvbnN0IHJlcG9Sb290ID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJy4uJyk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDEuIFJlZmVyZW5jZSB0aGUgU2VjcmV0cyBNYW5hZ2VyIHNlY3JldCAoY3JlYXRlZCBvdXRzaWRlIHRoaXMgc3RhY2spXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBhcHBTZWNyZXQgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICAgIHRoaXMsXG4gICAgICAnQXBwU2VjcmV0cycsXG4gICAgICBgJHthcHBOYW1lfS8ke2Vudmlyb25tZW50fS9zZWNyZXRzYFxuICAgICk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDIuIExhbWJkYSBleGVjdXRpb24gcm9sZVxuICAgIC8vICAgIC0gQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlIChDbG91ZFdhdGNoIExvZ3MpXG4gICAgLy8gICAgLSBTZWNyZXRzIE1hbmFnZXIgcmVhZCBhY2Nlc3MgZm9yIHRoZSBhcHAgc2VjcmV0XG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgICdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ1xuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IHJlYWQgYWNjZXNzIHRvIHRoZSBzZWNyZXRcbiAgICBhcHBTZWNyZXQuZ3JhbnRSZWFkKGxhbWJkYVJvbGUpO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAzLiBMb2cgcmV0ZW50aW9uOiAxMCB5ZWFycyBmb3IgcHJvZCwgMSB3ZWVrIGZvciBub24tcHJvZFxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgbG9nUmV0ZW50aW9uID1cbiAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgPyBsb2dzLlJldGVudGlvbkRheXMuVEVOX1lFQVJTXG4gICAgICAgIDogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyA0LiBBUEkgR2F0ZXdheSBSZXN0QXBpXG4gICAgLy8gICAgLSBTdGFnZSBuYW1lOiBcImFwaVwiXG4gICAgLy8gICAgLSBDbG91ZFdhdGNoIGFjY2VzcyBsb2dnaW5nXG4gICAgLy8gICAgLSBEZWZhdWx0IG1ldGhvZCB0aHJvdHRsaW5nIChyYXRlIDEwMCwgYnVyc3QgMjAwKVxuICAgIC8vICAgIC0gTm8gQ09SUyDigJQgQ2xvdWRGcm9udCBwcm94aWVzIC9hcGkvKiB0byBhdm9pZCBjcm9zcy1vcmlnaW4gaXNzdWVzXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBhcGlMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdBcGlHYXRld2F5QWNjZXNzTG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogbG9nUmV0ZW50aW9uLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnUmVzdEFwaScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgJHthcHBOYW1lfS0ke2Vudmlyb25tZW50fWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEFQSSBmb3IgJHthcHBOYW1lfSAoJHtlbnZpcm9ubWVudH0pYCxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiAnYXBpJyxcbiAgICAgICAgYWNjZXNzTG9nRGVzdGluYXRpb246IG5ldyBhcGlnYXRld2F5LkxvZ0dyb3VwTG9nRGVzdGluYXRpb24oYXBpTG9nR3JvdXApLFxuICAgICAgICBhY2Nlc3NMb2dGb3JtYXQ6IGFwaWdhdGV3YXkuQWNjZXNzTG9nRm9ybWF0Lmpzb25XaXRoU3RhbmRhcmRGaWVsZHMoKSxcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IGZhbHNlLFxuICAgICAgfSxcbiAgICAgIC8vIE5vIGRlZmF1bHRDb3JzUHJlZmxpZ2h0T3B0aW9ucyDigJQgQ2xvdWRGcm9udCBwcm94aWVzIC9hcGkvKlxuICAgIH0pO1xuXG4gICAgdGhpcy5hcGlHYXRld2F5RG9tYWluID0gYCR7dGhpcy5hcGkucmVzdEFwaUlkfS5leGVjdXRlLWFwaS4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNS4gQXV0by1kaXNjb3ZlciBMYW1iZGEgZnVuY3Rpb25zIGZyb20gdGhlIGxhbWJkYS8gZGlyZWN0b3J5XG4gICAgLy8gICAgRWFjaCBzdWItZGlyZWN0b3J5IGlzIHRyZWF0ZWQgYXMgb25lIGZ1bmN0aW9uLlxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgbGFtYmRhQmFzZURpciA9IHBhdGguam9pbihyZXBvUm9vdCwgJ2xhbWJkYScpO1xuICAgIGNvbnN0IGZ1bmN0aW9uRGlycyA9IGZzXG4gICAgICAucmVhZGRpclN5bmMobGFtYmRhQmFzZURpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNi4gQ3JlYXRlIGEgTm9kZWpzRnVuY3Rpb24gKyBBUEkgR2F0ZXdheSByZXNvdXJjZSBmb3IgZXZlcnkgZnVuY3Rpb25cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGZvciAoY29uc3QgZm5EaXIgb2YgZnVuY3Rpb25EaXJzKSB7XG4gICAgICAvLyBDb252ZXJ0IGRpcmVjdG9yeSBuYW1lIHRvIGEgdmFsaWQgbG9naWNhbCBJRCAoUGFzY2FsQ2FzZSlcbiAgICAgIGNvbnN0IGxvZ2ljYWxJZCA9IGZuRGlyXG4gICAgICAgIC5zcGxpdCgnLScpXG4gICAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJ0LnNsaWNlKDEpKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICAgIGNvbnN0IGZuRW50cnkgPSBwYXRoLmpvaW4obGFtYmRhQmFzZURpciwgZm5EaXIsICdpbmRleC50cycpO1xuXG4gICAgICAvLyBFeHBsaWNpdCBsb2cgZ3JvdXAgcGVyIGZ1bmN0aW9uIChhdm9pZHMgZGVwcmVjYXRlZCBsb2dSZXRlbnRpb24gcHJvcClcbiAgICAgIGNvbnN0IGZuTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBgJHtsb2dpY2FsSWR9TG9nR3JvdXBgLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhLyR7YXBwTmFtZX0tJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICByZXRlbnRpb246IGxvZ1JldGVudGlvbixcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBgJHtsb2dpY2FsSWR9RnVuY3Rpb25gLCB7XG4gICAgICAgIGZ1bmN0aW9uTmFtZTogYCR7YXBwTmFtZX0tJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICBlbnRyeTogZm5FbnRyeSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfTEFURVNULFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgICAgbG9nR3JvdXA6IGZuTG9nR3JvdXAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldC5zZWNyZXRBcm4sXG4gICAgICAgICAgRU5WSVJPTk1FTlQ6IGVudmlyb25tZW50LFxuICAgICAgICAgIEFQSV9HQVRFV0FZX1VSTDogYGh0dHBzOi8vJHt0aGlzLmFwaUdhdGV3YXlEb21haW59L2FwaWAsXG4gICAgICAgIH0sXG4gICAgICAgIGJ1bmRsaW5nOiB7XG4gICAgICAgICAgbWluaWZ5OiB0cnVlLFxuICAgICAgICAgIHNvdXJjZU1hcDogZmFsc2UsXG4gICAgICAgICAgdGFyZ2V0OiAnZXMyMDIyJyxcbiAgICAgICAgICAvLyBFeGNsdWRlIEFXUyBTREsgdjMg4oCUIGF2YWlsYWJsZSBpbiB0aGUgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsnQGF3cy1zZGsvKiddLFxuICAgICAgICB9LFxuICAgICAgICAvLyBwcm9qZWN0Um9vdCBtdXN0IGNvbnRhaW4gdGhlIGVudHJ5IGZpbGUg4oCUIHJlcG8gcm9vdCBob3VzZXMgbGFtYmRhL1xuICAgICAgICBwcm9qZWN0Um9vdDogcmVwb1Jvb3QsXG4gICAgICAgIC8vIFVzZSB0aGUgcmVwby1yb290IHBhY2thZ2UtbG9jay5qc29uIHNvIENESyBwaWNrcyBucG0gYXMgcGFja2FnZSBtYW5hZ2VyXG4gICAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihyZXBvUm9vdCwgJ3BhY2thZ2UtbG9jay5qc29uJyksXG4gICAgICB9KTtcblxuICAgICAgLy8gQVBJIEdhdGV3YXkgcmVzb3VyY2U6IC88Zm5EaXI+XG4gICAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoZm5EaXIpO1xuXG4gICAgICAvLyBTdXBwb3J0IGJvdGggR0VUIGFuZCBQT1NUXG4gICAgICBjb25zdCBsYW1iZGFJbnRlZ3JhdGlvbiA9IG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGZuLCB7XG4gICAgICAgIHJlcXVlc3RUZW1wbGF0ZXM6IHsgJ2FwcGxpY2F0aW9uL2pzb24nOiAneyBcInN0YXR1c0NvZGVcIjogXCIyMDBcIiB9JyB9LFxuICAgICAgfSk7XG5cbiAgICAgIHJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbGFtYmRhSW50ZWdyYXRpb24pO1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbGFtYmRhSW50ZWdyYXRpb24pO1xuICAgIH1cbiAgfVxufVxuIl19