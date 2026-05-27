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
        // 1. Reference secrets from Secrets Manager (created externally / by SecretsStack)
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `synthetic-supabase-app/${environment}/secrets`);
        // 2. Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Allow Lambda to read the secret
        appSecrets.grantRead(lambdaRole);
        // 3. No AI/Bedrock functions detected — skip Bedrock policy
        // 4. Log retention: 10 years for prod, 1 week for non-prod
        const logRetention = environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK;
        // API Gateway log group for access logging
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
            logGroupName: `/aws/apigateway/synthetic-supabase-app-${environment}`,
            retention: logRetention,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });
        // 4. Create API Gateway RestApi with stage "api", CloudWatch logging, throttling
        this.api = new apigateway.RestApi(this, 'AppApi', {
            restApiName: `synthetic-supabase-app-${environment}`,
            description: `API Gateway for synthetic-supabase-app (${environment})`,
            deployOptions: {
                stageName: 'api',
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: false,
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
            },
            // No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
            defaultCorsPreflightOptions: undefined,
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // 5. Auto-discover Lambda functions from the lambda/ directory
        // lambdaBaseDir resolves to <repo-root>/lambda from infra/lib/stacks/
        const lambdaBaseDir = path.join(__dirname, '..', '..', '..', 'lambda');
        // projectRoot must cover both infra/ and lambda/ — set to the repo root
        const repoRoot = path.join(__dirname, '..', '..', '..');
        const functionDirs = fs
            .readdirSync(lambdaBaseDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // 6. For each discovered function: create NodejsFunction + API Gateway resource + methods
        for (const fnDir of functionDirs) {
            // Convert kebab-case dir name to PascalCase for CDK logical IDs
            const logicalId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            // Convert kebab-case dir name to camelCase for route path
            const routePath = fnDir; // keep as-is (e.g. "hello-world", "process-payment")
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${logicalId}Function`, {
                functionName: `synthetic-supabase-app-${environment}-${fnDir}`,
                runtime: lambda.Runtime.NODEJS_LATEST,
                entry: path.join(lambdaBaseDir, fnDir, 'index.ts'),
                handler: 'handler',
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                projectRoot: repoRoot,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                logRetention: logRetention,
                bundling: {
                    minify: true,
                    sourceMap: false,
                    target: 'es2022',
                    externalModules: [
                        // AWS SDK v3 is provided by the Lambda runtime
                        '@aws-sdk/*',
                    ],
                },
            });
            // Create API resource and add POST + GET methods
            const resource = this.api.root.addResource(routePath);
            resource.addMethod('POST', new apigateway.LambdaIntegration(fn));
            resource.addMethod('GET', new apigateway.LambdaIntegration(fn));
        }
        // 7. Outputs
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: this.api.url,
            description: 'API Gateway invoke URL',
            exportName: `synthetic-supabase-app-${environment}-api-url`,
        });
        new cdk.CfnOutput(this, 'ApiGatewayDomain', {
            value: this.apiGatewayDomain,
            description: 'API Gateway domain (no protocol, no path)',
            exportName: `synthetic-supabase-app-${environment}-api-domain`,
        });
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlCLG1GQUFtRjtRQUNuRixNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUN2RCxJQUFJLEVBQ0osWUFBWSxFQUNaLDBCQUEwQixXQUFXLFVBQVUsQ0FDaEQsQ0FBQztRQUVGLG1GQUFtRjtRQUNuRixNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDeEMsMENBQTBDLENBQzNDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUVqQyw0REFBNEQ7UUFFNUQsMkRBQTJEO1FBQzNELE1BQU0sWUFBWSxHQUNoQixX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Q0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQjtZQUM1QixXQUFXLEVBQUUsMkNBQTJDO1lBQ3hELFVBQVUsRUFBRSwwQkFBMEIsV0FBVyxhQUFhO1NBQy9ELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQWpJRCxrQ0FpSUMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTGFtYmRhU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gIHB1YmxpYyByZWFkb25seSBhcGlHYXRld2F5RG9tYWluOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gMS4gUmVmZXJlbmNlIHNlY3JldHMgZnJvbSBTZWNyZXRzIE1hbmFnZXIgKGNyZWF0ZWQgZXh0ZXJuYWxseSAvIGJ5IFNlY3JldHNTdGFjaylcbiAgICBjb25zdCBhcHBTZWNyZXRzID0gc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIoXG4gICAgICB0aGlzLFxuICAgICAgJ0FwcFNlY3JldHMnLFxuICAgICAgYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAvJHtlbnZpcm9ubWVudH0vc2VjcmV0c2AsXG4gICAgKTtcblxuICAgIC8vIDIuIExhbWJkYSBleGVjdXRpb24gcm9sZSB3aXRoIEFXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZSArIFNlY3JldHMgTWFuYWdlciByZWFkXG4gICAgY29uc3QgbGFtYmRhUm9sZSA9IG5ldyBpYW0uUm9sZSh0aGlzLCAnTGFtYmRhRXhlY3V0aW9uUm9sZScsIHtcbiAgICAgIGFzc3VtZWRCeTogbmV3IGlhbS5TZXJ2aWNlUHJpbmNpcGFsKCdsYW1iZGEuYW1hem9uYXdzLmNvbScpLFxuICAgICAgbWFuYWdlZFBvbGljaWVzOiBbXG4gICAgICAgIGlhbS5NYW5hZ2VkUG9saWN5LmZyb21Bd3NNYW5hZ2VkUG9saWN5TmFtZShcbiAgICAgICAgICAnc2VydmljZS1yb2xlL0FXU0xhbWJkYUJhc2ljRXhlY3V0aW9uUm9sZScsXG4gICAgICAgICksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gQWxsb3cgTGFtYmRhIHRvIHJlYWQgdGhlIHNlY3JldFxuICAgIGFwcFNlY3JldHMuZ3JhbnRSZWFkKGxhbWJkYVJvbGUpO1xuXG4gICAgLy8gMy4gTm8gQUkvQmVkcm9jayBmdW5jdGlvbnMgZGV0ZWN0ZWQg4oCUIHNraXAgQmVkcm9jayBwb2xpY3lcblxuICAgIC8vIDQuIExvZyByZXRlbnRpb246IDEwIHllYXJzIGZvciBwcm9kLCAxIHdlZWsgZm9yIG5vbi1wcm9kXG4gICAgY29uc3QgbG9nUmV0ZW50aW9uID1cbiAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgPyBsb2dzLlJldGVudGlvbkRheXMuVEVOX1lFQVJTXG4gICAgICAgIDogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLO1xuXG4gICAgLy8gQVBJIEdhdGV3YXkgbG9nIGdyb3VwIGZvciBhY2Nlc3MgbG9nZ2luZ1xuICAgIGNvbnN0IGFwaUxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgJ0FwaUdhdGV3YXlBY2Nlc3NMb2dzJywge1xuICAgICAgbG9nR3JvdXBOYW1lOiBgL2F3cy9hcGlnYXRld2F5L3N5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgcmV0ZW50aW9uOiBsb2dSZXRlbnRpb24sXG4gICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU4sXG4gICAgfSk7XG5cbiAgICAvLyA0LiBDcmVhdGUgQVBJIEdhdGV3YXkgUmVzdEFwaSB3aXRoIHN0YWdlIFwiYXBpXCIsIENsb3VkV2F0Y2ggbG9nZ2luZywgdGhyb3R0bGluZ1xuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBwQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGBzeW50aGV0aWMtc3VwYWJhc2UtYXBwLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiBgQVBJIEdhdGV3YXkgZm9yIHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAgKCR7ZW52aXJvbm1lbnR9KWAsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ2FwaScsXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKGFwaUxvZ0dyb3VwKSxcbiAgICAgICAgYWNjZXNzTG9nRm9ybWF0OiBhcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5qc29uV2l0aFN0YW5kYXJkRmllbGRzKCksXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgZGF0YVRyYWNlRW5hYmxlZDogZmFsc2UsXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDIwMCxcbiAgICAgIH0sXG4gICAgICAvLyBObyBDT1JTIGNvbmZpZyBuZWVkZWQg4oCUIENsb3VkRnJvbnQgcHJveGllcyAvYXBpLyogdG8gYXZvaWQgY3Jvc3Mtb3JpZ2luIGlzc3Vlc1xuICAgICAgZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zOiB1bmRlZmluZWQsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaUdhdGV3YXlEb21haW4gPSBgJHt0aGlzLmFwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gO1xuXG4gICAgLy8gNS4gQXV0by1kaXNjb3ZlciBMYW1iZGEgZnVuY3Rpb25zIGZyb20gdGhlIGxhbWJkYS8gZGlyZWN0b3J5XG4gICAgLy8gbGFtYmRhQmFzZURpciByZXNvbHZlcyB0byA8cmVwby1yb290Pi9sYW1iZGEgZnJvbSBpbmZyYS9saWIvc3RhY2tzL1xuICAgIGNvbnN0IGxhbWJkYUJhc2VEaXIgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnLi4nLCAnbGFtYmRhJyk7XG4gICAgLy8gcHJvamVjdFJvb3QgbXVzdCBjb3ZlciBib3RoIGluZnJhLyBhbmQgbGFtYmRhLyDigJQgc2V0IHRvIHRoZSByZXBvIHJvb3RcbiAgICBjb25zdCByZXBvUm9vdCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICcuLicpO1xuICAgIGNvbnN0IGZ1bmN0aW9uRGlycyA9IGZzXG4gICAgICAucmVhZGRpclN5bmMobGFtYmRhQmFzZURpciwgeyB3aXRoRmlsZVR5cGVzOiB0cnVlIH0pXG4gICAgICAuZmlsdGVyKChlbnRyeSkgPT4gZW50cnkuaXNEaXJlY3RvcnkoKSlcbiAgICAgIC5tYXAoKGVudHJ5KSA9PiBlbnRyeS5uYW1lKTtcblxuICAgIC8vIDYuIEZvciBlYWNoIGRpc2NvdmVyZWQgZnVuY3Rpb246IGNyZWF0ZSBOb2RlanNGdW5jdGlvbiArIEFQSSBHYXRld2F5IHJlc291cmNlICsgbWV0aG9kc1xuICAgIGZvciAoY29uc3QgZm5EaXIgb2YgZnVuY3Rpb25EaXJzKSB7XG4gICAgICAvLyBDb252ZXJ0IGtlYmFiLWNhc2UgZGlyIG5hbWUgdG8gUGFzY2FsQ2FzZSBmb3IgQ0RLIGxvZ2ljYWwgSURzXG4gICAgICBjb25zdCBsb2dpY2FsSWQgPSBmbkRpclxuICAgICAgICAuc3BsaXQoJy0nKVxuICAgICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydC5zbGljZSgxKSlcbiAgICAgICAgLmpvaW4oJycpO1xuXG4gICAgICAvLyBDb252ZXJ0IGtlYmFiLWNhc2UgZGlyIG5hbWUgdG8gY2FtZWxDYXNlIGZvciByb3V0ZSBwYXRoXG4gICAgICBjb25zdCByb3V0ZVBhdGggPSBmbkRpcjsgLy8ga2VlcCBhcy1pcyAoZS5nLiBcImhlbGxvLXdvcmxkXCIsIFwicHJvY2Vzcy1wYXltZW50XCIpXG5cbiAgICAgIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIGAke2xvZ2ljYWxJZH1GdW5jdGlvbmAsIHtcbiAgICAgICAgZnVuY3Rpb25OYW1lOiBgc3ludGhldGljLXN1cGFiYXNlLWFwcC0ke2Vudmlyb25tZW50fS0ke2ZuRGlyfWAsXG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU19MQVRFU1QsXG4gICAgICAgIGVudHJ5OiBwYXRoLmpvaW4obGFtYmRhQmFzZURpciwgZm5EaXIsICdpbmRleC50cycpLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgICBwcm9qZWN0Um9vdDogcmVwb1Jvb3QsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICBBUElfR0FURVdBWV9VUkw6IGBodHRwczovLyR7dGhpcy5hcGlHYXRld2F5RG9tYWlufS9hcGlgLFxuICAgICAgICB9LFxuICAgICAgICBsb2dSZXRlbnRpb246IGxvZ1JldGVudGlvbixcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiBmYWxzZSxcbiAgICAgICAgICB0YXJnZXQ6ICdlczIwMjInLFxuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgLy8gQVdTIFNESyB2MyBpcyBwcm92aWRlZCBieSB0aGUgTGFtYmRhIHJ1bnRpbWVcbiAgICAgICAgICAgICdAYXdzLXNkay8qJyxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIENyZWF0ZSBBUEkgcmVzb3VyY2UgYW5kIGFkZCBQT1NUICsgR0VUIG1ldGhvZHNcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShyb3V0ZVBhdGgpO1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZm4pKTtcbiAgICAgIHJlc291cmNlLmFkZE1ldGhvZCgnR0VUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZm4pKTtcbiAgICB9XG5cbiAgICAvLyA3LiBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGkudXJsLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBpbnZva2UgVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBzeW50aGV0aWMtc3VwYWJhc2UtYXBwLSR7ZW52aXJvbm1lbnR9LWFwaS11cmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlEb21haW4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGlHYXRld2F5RG9tYWluLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBkb21haW4gKG5vIHByb3RvY29sLCBubyBwYXRoKScsXG4gICAgICBleHBvcnROYW1lOiBgc3ludGhldGljLXN1cGFiYXNlLWFwcC0ke2Vudmlyb25tZW50fS1hcGktZG9tYWluYCxcbiAgICB9KTtcbiAgfVxufVxuIl19