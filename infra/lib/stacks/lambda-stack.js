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
        // __dirname = <repo>/infra/lib/stacks  →  repo root is three levels up
        const repoRoot = path.resolve(__dirname, '..', '..', '..');
        // 1. Reference secrets from Secrets Manager
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `SyntheticSupabaseApp/${environment}/secrets`);
        // 2. Create Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant Secrets Manager read access
        appSecrets.grantRead(lambdaRole);
        // 3. Create CloudWatch log group for API Gateway
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
            logGroupName: `/aws/apigateway/SyntheticSupabaseApp-${environment}`,
            retention: environment === 'prod'
                ? logs.RetentionDays.TEN_YEARS
                : logs.RetentionDays.ONE_WEEK,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        // 4. Create API Gateway RestApi with stage "api", CloudWatch logging, throttling
        //    No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
        this.api = new apigateway.RestApi(this, 'RestApi', {
            restApiName: `SyntheticSupabaseApp-${environment}`,
            description: `API Gateway for SyntheticSupabaseApp (${environment})`,
            deployOptions: {
                stageName: 'api',
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: false,
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
            },
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // 5. Auto-discover Lambda functions from the lambda/ directory
        const lambdaDir = path.join(repoRoot, 'lambda');
        const functionDirs = fs
            .readdirSync(lambdaDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // 6. For each function: NodejsFunction with esbuild bundling, API Gateway resource + POST/GET methods
        for (const fnDir of functionDirs) {
            // Convert kebab-case dir name to PascalCase for CDK construct IDs
            const fnId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            const lambdaLogGroup = new logs.LogGroup(this, `${fnId}LogGroup`, {
                logGroupName: `/aws/lambda/SyntheticSupabaseApp-${environment}-${fnDir}`,
                retention: environment === 'prod'
                    ? logs.RetentionDays.TEN_YEARS
                    : logs.RetentionDays.ONE_WEEK,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${fnId}Function`, {
                functionName: `SyntheticSupabaseApp-${environment}-${fnDir}`,
                runtime: lambda.Runtime.NODEJS_LATEST,
                handler: 'handler',
                entry: path.join(lambdaDir, fnDir, 'index.ts'),
                // projectRoot must point to repo root so NodejsFunction accepts
                // entry paths outside the infra/ directory
                projectRoot: repoRoot,
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                logGroup: lambdaLogGroup,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                bundling: {
                    minify: true,
                    sourceMap: false,
                    target: 'node18',
                    // AWS SDK v3 is available in the Lambda Node.js runtime — keep it external
                    // to avoid bloating the bundle. All other deps are bundled.
                    externalModules: ['@aws-sdk/*'],
                },
            });
            // Create API Gateway resource matching the function directory name
            const resource = this.api.root.addResource(fnDir);
            // Add POST and GET methods
            resource.addMethod('POST', new apigateway.LambdaIntegration(fn, { proxy: true }));
            resource.addMethod('GET', new apigateway.LambdaIntegration(fn, { proxy: true }));
        }
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlCLHVFQUF1RTtRQUN2RSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsT0FBTyxDQUFDLFNBQVMsRUFBRSxJQUFJLEVBQUUsSUFBSSxFQUFFLElBQUksQ0FBQyxDQUFDO1FBRTNELDRDQUE0QztRQUM1QyxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUN2RCxJQUFJLEVBQ0osWUFBWSxFQUNaLHdCQUF3QixXQUFXLFVBQVUsQ0FDOUMsQ0FBQztRQUVGLDBGQUEwRjtRQUMxRixNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDeEMsMENBQTBDLENBQzNDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFF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LENBQUMsRUFBRSxFQUFFLEVBQUUsS0FBSyxFQUFFLElBQUksRUFBRSxDQUFDLENBQ3RELENBQUM7UUFDSixDQUFDO0lBQ0gsQ0FBQztDQUNGO0FBN0hELGtDQTZIQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBsYW1iZGEgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYSc7XG5pbXBvcnQgeyBOb2RlanNGdW5jdGlvbiB9IGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEtbm9kZWpzJztcbmltcG9ydCAqIGFzIGFwaWdhdGV3YXkgZnJvbSAnYXdzLWNkay1saWIvYXdzLWFwaWdhdGV3YXknO1xuaW1wb3J0ICogYXMgc2VjcmV0c21hbmFnZXIgZnJvbSAnYXdzLWNkay1saWIvYXdzLXNlY3JldHNtYW5hZ2VyJztcbmltcG9ydCAqIGFzIGlhbSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtaWFtJztcbmltcG9ydCAqIGFzIGxvZ3MgZnJvbSAnYXdzLWNkay1saWIvYXdzLWxvZ3MnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5pbXBvcnQgKiBhcyBmcyBmcm9tICdmcyc7XG5pbXBvcnQgKiBhcyBwYXRoIGZyb20gJ3BhdGgnO1xuXG5leHBvcnQgaW50ZXJmYWNlIExhbWJkYVN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBMYW1iZGFTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBhcGk6IGFwaWdhdGV3YXkuUmVzdEFwaTtcbiAgcHVibGljIHJlYWRvbmx5IGFwaUdhdGV3YXlEb21haW46IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogTGFtYmRhU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCB9ID0gcHJvcHM7XG5cbiAgICAvLyBfX2Rpcm5hbWUgPSA8cmVwbz4vaW5mcmEvbGliL3N0YWNrcyAg4oaSICByZXBvIHJvb3QgaXMgdGhyZWUgbGV2ZWxzIHVwXG4gICAgY29uc3QgcmVwb1Jvb3QgPSBwYXRoLnJlc29sdmUoX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnLi4nKTtcblxuICAgIC8vIDEuIFJlZmVyZW5jZSBzZWNyZXRzIGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgY29uc3QgYXBwU2VjcmV0cyA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgICAgdGhpcyxcbiAgICAgICdBcHBTZWNyZXRzJyxcbiAgICAgIGBTeW50aGV0aWNTdXBhYmFzZUFwcC8ke2Vudmlyb25tZW50fS9zZWNyZXRzYFxuICAgICk7XG5cbiAgICAvLyAyLiBDcmVhdGUgTGFtYmRhIGV4ZWN1dGlvbiByb2xlIHdpdGggQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlICsgU2VjcmV0cyBNYW5hZ2VyIHJlYWRcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgICdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ1xuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IFNlY3JldHMgTWFuYWdlciByZWFkIGFjY2Vzc1xuICAgIGFwcFNlY3JldHMuZ3JhbnRSZWFkKGxhbWJkYVJvbGUpO1xuXG4gICAgLy8gMy4gQ3JlYXRlIENsb3VkV2F0Y2ggbG9nIGdyb3VwIGZvciBBUEkgR2F0ZXdheVxuICAgIGNvbnN0IGFwaUxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0FwaUdhdGV3YXlMb2dHcm91cCcsIHtcbiAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvYXBpZ2F0ZXdheS9TeW50aGV0aWNTdXBhYmFzZUFwcC0ke2Vudmlyb25tZW50fWAsXG4gICAgICByZXRlbnRpb246XG4gICAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgICA/IGxvZ3MuUmV0ZW50aW9uRGF5cy5URU5fWUVBUlNcbiAgICAgICAgICA6IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSyxcbiAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgfSk7XG5cbiAgICAvLyA0LiBDcmVhdGUgQVBJIEdhdGV3YXkgUmVzdEFwaSB3aXRoIHN0YWdlIFwiYXBpXCIsIENsb3VkV2F0Y2ggbG9nZ2luZywgdGhyb3R0bGluZ1xuICAgIC8vICAgIE5vIENPUlMgY29uZmlnIG5lZWRlZCDigJQgQ2xvdWRGcm9udCBwcm94aWVzIC9hcGkvKiB0byBhdm9pZCBjcm9zcy1vcmlnaW4gaXNzdWVzXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdSZXN0QXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGBTeW50aGV0aWNTdXBhYmFzZUFwcC0ke2Vudmlyb25tZW50fWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEFQSSBHYXRld2F5IGZvciBTeW50aGV0aWNTdXBhYmFzZUFwcCAoJHtlbnZpcm9ubWVudH0pYCxcbiAgICAgIGRlcGxveU9wdGlvbnM6IHtcbiAgICAgICAgc3RhZ2VOYW1lOiAnYXBpJyxcbiAgICAgICAgYWNjZXNzTG9nRGVzdGluYXRpb246IG5ldyBhcGlnYXRld2F5LkxvZ0dyb3VwTG9nRGVzdGluYXRpb24oYXBpTG9nR3JvdXApLFxuICAgICAgICBhY2Nlc3NMb2dGb3JtYXQ6IGFwaWdhdGV3YXkuQWNjZXNzTG9nRm9ybWF0Lmpzb25XaXRoU3RhbmRhcmRGaWVsZHMoKSxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBkYXRhVHJhY2VFbmFibGVkOiBmYWxzZSxcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXBpR2F0ZXdheURvbWFpbiA9IGAke3RoaXMuYXBpLnJlc3RBcGlJZH0uZXhlY3V0ZS1hcGkuJHt0aGlzLnJlZ2lvbn0uYW1hem9uYXdzLmNvbWA7XG5cbiAgICAvLyA1LiBBdXRvLWRpc2NvdmVyIExhbWJkYSBmdW5jdGlvbnMgZnJvbSB0aGUgbGFtYmRhLyBkaXJlY3RvcnlcbiAgICBjb25zdCBsYW1iZGFEaXIgPSBwYXRoLmpvaW4ocmVwb1Jvb3QsICdsYW1iZGEnKTtcbiAgICBjb25zdCBmdW5jdGlvbkRpcnMgPSBmc1xuICAgICAgLnJlYWRkaXJTeW5jKGxhbWJkYURpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICAgIC8vIDYuIEZvciBlYWNoIGZ1bmN0aW9uOiBOb2RlanNGdW5jdGlvbiB3aXRoIGVzYnVpbGQgYnVuZGxpbmcsIEFQSSBHYXRld2F5IHJlc291cmNlICsgUE9TVC9HRVQgbWV0aG9kc1xuICAgIGZvciAoY29uc3QgZm5EaXIgb2YgZnVuY3Rpb25EaXJzKSB7XG4gICAgICAvLyBDb252ZXJ0IGtlYmFiLWNhc2UgZGlyIG5hbWUgdG8gUGFzY2FsQ2FzZSBmb3IgQ0RLIGNvbnN0cnVjdCBJRHNcbiAgICAgIGNvbnN0IGZuSWQgPSBmbkRpclxuICAgICAgICAuc3BsaXQoJy0nKVxuICAgICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydC5zbGljZSgxKSlcbiAgICAgICAgLmpvaW4oJycpO1xuXG4gICAgICBjb25zdCBsYW1iZGFMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIGAke2ZuSWR9TG9nR3JvdXBgLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhL1N5bnRoZXRpY1N1cGFiYXNlQXBwLSR7ZW52aXJvbm1lbnR9LSR7Zm5EaXJ9YCxcbiAgICAgICAgcmV0ZW50aW9uOlxuICAgICAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgICAgID8gbG9ncy5SZXRlbnRpb25EYXlzLlRFTl9ZRUFSU1xuICAgICAgICAgICAgOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9KTtcblxuICAgICAgY29uc3QgZm4gPSBuZXcgTm9kZWpzRnVuY3Rpb24odGhpcywgYCR7Zm5JZH1GdW5jdGlvbmAsIHtcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgU3ludGhldGljU3VwYWJhc2VBcHAtJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfTEFURVNULFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4obGFtYmRhRGlyLCBmbkRpciwgJ2luZGV4LnRzJyksXG4gICAgICAgIC8vIHByb2plY3RSb290IG11c3QgcG9pbnQgdG8gcmVwbyByb290IHNvIE5vZGVqc0Z1bmN0aW9uIGFjY2VwdHNcbiAgICAgICAgLy8gZW50cnkgcGF0aHMgb3V0c2lkZSB0aGUgaW5mcmEvIGRpcmVjdG9yeVxuICAgICAgICBwcm9qZWN0Um9vdDogcmVwb1Jvb3QsXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgICBsb2dHcm91cDogbGFtYmRhTG9nR3JvdXAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICBBUElfR0FURVdBWV9VUkw6IGBodHRwczovLyR7dGhpcy5hcGlHYXRld2F5RG9tYWlufS9hcGlgLFxuICAgICAgICB9LFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2VNYXA6IGZhbHNlLFxuICAgICAgICAgIHRhcmdldDogJ25vZGUxOCcsXG4gICAgICAgICAgLy8gQVdTIFNESyB2MyBpcyBhdmFpbGFibGUgaW4gdGhlIExhbWJkYSBOb2RlLmpzIHJ1bnRpbWUg4oCUIGtlZXAgaXQgZXh0ZXJuYWxcbiAgICAgICAgICAvLyB0byBhdm9pZCBibG9hdGluZyB0aGUgYnVuZGxlLiBBbGwgb3RoZXIgZGVwcyBhcmUgYnVuZGxlZC5cbiAgICAgICAgICBleHRlcm5hbE1vZHVsZXM6IFsnQGF3cy1zZGsvKiddLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIENyZWF0ZSBBUEkgR2F0ZXdheSByZXNvdXJjZSBtYXRjaGluZyB0aGUgZnVuY3Rpb24gZGlyZWN0b3J5IG5hbWVcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShmbkRpcik7XG5cbiAgICAgIC8vIEFkZCBQT1NUIGFuZCBHRVQgbWV0aG9kc1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKFxuICAgICAgICAnUE9TVCcsXG4gICAgICAgIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGZuLCB7IHByb3h5OiB0cnVlIH0pXG4gICAgICApO1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKFxuICAgICAgICAnR0VUJyxcbiAgICAgICAgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZm4sIHsgcHJveHk6IHRydWUgfSlcbiAgICAgICk7XG4gICAgfVxuICB9XG59XG4iXX0=