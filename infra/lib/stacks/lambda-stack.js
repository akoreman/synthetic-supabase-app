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
        const isProd = environment === 'prod';
        // Repo root is 3 levels up from infra/lib/stacks/
        const repoRoot = path.join(__dirname, '..', '..', '..');
        const lambdaBaseDir = path.join(repoRoot, 'lambda');
        // 1. Reference secrets from Secrets Manager
        // Path: SyntheticSupabaseApp/<environment>/secrets
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `SyntheticSupabaseApp/${environment}/secrets`);
        // 2. Create Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant Secrets Manager read access to the execution role
        appSecrets.grantRead(lambdaRole);
        // 3. Create API Gateway RestApi with stage "api", CloudWatch logging, throttling
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
            retention: isProd
                ? logs.RetentionDays.TEN_YEARS
                : logs.RetentionDays.ONE_WEEK,
            removalPolicy: isProd
                ? cdk.RemovalPolicy.RETAIN
                : cdk.RemovalPolicy.DESTROY,
        });
        this.api = new apigateway.RestApi(this, 'AppApi', {
            restApiName: `synthetic-supabase-app-${environment}`,
            description: `API for synthetic-supabase-app (${environment})`,
            deployOptions: {
                stageName: 'api',
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
            },
            // No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // 4. Auto-discover Lambda functions from the lambda/ directory at the repo root.
        const functionDirs = fs
            .readdirSync(lambdaBaseDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // 5. For each function: NodejsFunction + API Gateway resource + POST/GET methods
        for (const fnDir of functionDirs) {
            const entryFile = path.join(lambdaBaseDir, fnDir, 'index.ts');
            if (!fs.existsSync(entryFile))
                continue;
            // Convert kebab-case directory name to PascalCase for CDK logical IDs
            // e.g. hello-world → HelloWorld, process-payment → ProcessPayment
            const logicalId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            // Log group for each Lambda function
            const fnLogGroup = new logs.LogGroup(this, `${logicalId}LogGroup`, {
                logGroupName: `/aws/lambda/synthetic-supabase-app-${environment}-${fnDir}`,
                retention: isProd
                    ? logs.RetentionDays.TEN_YEARS
                    : logs.RetentionDays.ONE_WEEK,
                removalPolicy: isProd
                    ? cdk.RemovalPolicy.RETAIN
                    : cdk.RemovalPolicy.DESTROY,
            });
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${logicalId}Function`, {
                functionName: `synthetic-supabase-app-${environment}-${fnDir}`,
                runtime: lambda.Runtime.NODEJS_LATEST,
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                entry: entryFile,
                handler: 'handler',
                // projectRoot must be set to repo root so NodejsFunction can locate
                // the entry file outside the infra/ CDK project directory
                projectRoot: repoRoot,
                bundling: {
                    minify: true,
                    sourceMap: true,
                    target: 'es2022',
                    // Bundle all app dependencies; mark AWS SDK packages as external
                    // (they are provided by the Lambda runtime for NODEJS_LATEST)
                    externalModules: [
                        '@aws-sdk/*',
                        '@smithy/*',
                    ],
                },
                logGroup: fnLogGroup,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
            });
            // Add API Gateway resource and methods (GET + POST)
            const resource = this.api.root.addResource(fnDir);
            resource.addMethod('GET', new apigateway.LambdaIntegration(fn));
            resource.addMethod('POST', new apigateway.LambdaIntegration(fn));
        }
        // Stack outputs
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: `https://${this.apiGatewayDomain}/api`,
            description: 'API Gateway base URL',
            exportName: `${id}-ApiGatewayUrl`,
        });
        new cdk.CfnOutput(this, 'ApiGatewayDomain', {
            value: this.apiGatewayDomain,
            description: 'API Gateway domain (no protocol)',
            exportName: `${id}-ApiGatewayDomain`,
        });
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBQzlCLE1BQU0sTUFBTSxHQUFHLFdBQVcsS0FBSyxNQUFNLENBQUM7UUFFdEMsa0RBQWtEO1FBQ2xELE1BQU0sUUFBUSxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsU0FBUyxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsSUFBSSxDQUFDLENBQUM7UUFDeEQsTUFBTSxhQUFhLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsUUFBUSxDQUFDLENBQUM7UUFFcEQsNENBQTRDO1FBQzVDLG1EQUFtRDtRQUNuRCxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUN2RCxJQUFJLEVBQ0osWUFBWSxFQUNaLHdCQUF3QixXQUFXLFVBQVUsQ0FDOUMsQ0FBQztRQUVGLDBGQUEwRjtRQUMxRixNQUFNLFVBQVUsR0FBRyxJQUFJLEdBQUcsQ0FBQyxJQUFJLENBQUMsSUFBSSxFQUFFLHFCQUFxQixFQUFFO1lBQzNELFNBQVMsRUFBRSxJQUFJLEdBQUcsQ0FBQyxnQkFBZ0IsQ0FBQyxzQkFBc0IsQ0FBQztZQUMzRCxlQUFlLEVBQUU7Z0JBQ2YsR0FBRyxDQUFDLGFBQWEsQ0FBQyx3QkFBd0IsQ0FDeEMsMENBQTBDLENBQzNDO2FBQ0Y7U0FDRixDQUFDLENBQUM7UUFFSCwwREFBMEQ7UUFDMUQsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUVqQyxpRkFBaUY7UUFDakYsTUFBTSxXQUFXLEdBQUcsSUFBSSxJQUFJLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxzQkFBc0IsRUFBRTtZQUNsRSxTQUFTLEVBQUUsTUFBTTtnQkFDZixDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxTQUFTO2dCQUM5QixDQUFDLENBQUMsSUFBSSxDQUFDLGFBQWEsQ0FBQyxRQUFRO1lBQy9CLGFBQWEsRUFBRSxNQUFNO2dCQUNuQixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxNQUFNO2dCQUMxQixDQUFDLENBQUMsR0FBRyxDQUFDLGFBQWEsQ0FBQyxPQUFPO1NBQzlCLENBQUMsQ0FBQztRQUVILElBQUksQ0FBQyxHQUFHLEdBQUcsSUFBSSxVQUFVLENBQUMsT0FBTyxDQUFDLElBQUksRUFBRSxRQUFRLEVBQUU7WUFDaEQsV0FBVyxFQUFFLDBCQUEwQixXQUFXLEVBQUU7WUFDcEQsV0FBVyxFQUFFLG1DQUFtQyxXQUFXLEdBQUc7WUFDOUQsYUFBYSxFQUFFO2dCQUNiLFNBQVMsRUFBRSxLQUFLO2dCQUNoQixvQkFBb0IsRUFBRSxJQUFJLFVBQVUsQ0FBQyxzQkFBc0IsQ0FBQyxXQUFXLENBQUM7Z0JBQ3hFLGVBQWUsRUFBRSxVQUFVLENBQUMsZUFBZSxDQUFDLHNCQUFzQixFQUFFO2dCQUNwRSxZQUFZLEVBQUUsVUFBVSxDQUFDLGtCQUFrQixDQUFDLElBQUk7Z0JBQ2hELG1CQUFtQixFQUFFLEdBQUc7Z0JBQ3hCLG9CQUFvQixFQUFFLEdBQUc7YUFDMUI7WUFDRCxpRkFBaUY7U0FDbEYsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLGdCQUFnQixHQUFHLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxTQUFTLGdCQUFnQixJQUFJLENBQUMsTUFBTSxnQkFBZ0IsQ0FBQztRQUV6RixpRkFBaUY7UUFDakYsTUFBTSxZQUFZLEdBQUcsRUFBRTthQUNwQixXQUFXLENBQUMsYUFBYSxFQUFFLEVBQUUsYUFBYSxFQUFFLElBQUksRUFBRSxDQUFDO2FBQ25ELE1BQU0sQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLFdBQVcsRUFBRSxDQUFDO2FBQ3RDLEdBQUcsQ0FBQyxDQUFDLEtBQUssRUFBRSxFQUFFLENBQUMsS0FBSyxDQUFDLElBQUksQ0FBQyxDQUFDO1FBRTlCLGlGQUFpRjtRQUNqRixLQUFLLE1BQU0sS0FBSyxJQUFJLFlBQVksRUFBRSxDQUFDO1lBQ2pDLE1BQU0sU0FBUyxHQUFHLElBQUksQ0FBQyxJQUFJLENBQUMsYUFBYSxFQUFFLEtBQUssRUFBRSxVQUFVLENBQUMsQ0FBQztZQUM5RCxJQUFJLENBQUMsRUFBRSxDQUFDLFVBQVUsQ0FBQyxTQUFTLENBQUM7Z0JBQUUsU0FBUztZQUV4QyxzRUFBc0U7WUFDdEUsa0VBQWtFO1lBQ2xFLE1BQU0sU0FBUyxHQUFHLEtBQUs7aUJBQ3BCLEtBQUssQ0FBQyxHQUFHLENBQUM7aUJBQ1YsR0FBRyxDQUFDLENBQUMsSUFBSSxFQUFFLEVBQUUsQ0FBQyxJQUFJLENBQUMsTUFBTSxDQUFDLENBQUMsQ0FBQyxDQUFDLFdBQVcsRUFBRSxHQUFHLElBQUksQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFDLENBQUM7aUJBQzNELElBQUksQ0FBQyxFQUFFLENBQUMsQ0FBQztZQUVaLHFDQUFxQztZQUNyQyxNQUFNLFVBQVUsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsU0FBUyxVQUFVLEVBQUU7Z0JBQ2pFLFlBQVksRUFBRSxzQ0FBc0MsV0FBVyxJQUFJLEtBQUssRUFBRTtnQkFDMUUsU0FBUyxFQUFFLE1BQU07b0JBQ2YsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsU0FBUztvQkFDOUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUTtnQkFDL0IsYUFBYSxFQUFFLE1BQU07b0JBQ25CLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE1BQU07b0JBQzFCLENBQUMsQ0FBQyxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87YUFDOUIsQ0FBQyxDQUFDO1lBRUgsTUFBTSxFQUFFLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLFNBQVMsVUFBVSxFQUFFO2dCQUMxRCxZQUFZLEVBQUUsMEJBQTBCLFdBQVcsSUFBSSxLQUFLLEVBQUU7Z0JBQzlELE9BQU8sRUFBRSxNQUFNLENBQUMsT0FBTyxDQUFDLGFBQWE7Z0JBQ3JDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLFVBQVUsRUFBRSxHQUFHO2dCQUNmLElBQUksRUFBRSxVQUFVO2dCQUNoQixLQUFLLEVBQUUsU0FBUztnQkFDaEIsT0FBTyxFQUFFLFNBQVM7Z0JBQ2xCLG9FQUFvRTtnQkFDcEUsMERBQTBEO2dCQUMxRCxXQUFXLEVBQUUsUUFBUTtnQkFDckIsUUFBUSxFQUFFO29CQUNSLE1BQU0sRUFBRSxJQUFJO29CQUNaLFNBQVMsRUFBRSxJQUFJO29CQUNmLE1BQU0sRUFBRSxRQUFRO29CQUNoQixpRUFBaUU7b0JBQ2pFLDhEQUE4RDtvQkFDOUQsZUFBZSxFQUFFO3dCQUNmLFlBQVk7d0JBQ1osV0FBVztxQkFDWjtpQkFDRjtnQkFDRCxRQUFRLEVBQUUsVUFBVTtnQkFDcEIsV0FBVyxFQUFFO29CQUNYLFdBQVcsRUFBRSxVQUFVLENBQUMsU0FBUztvQkFDakMsV0FBVyxFQUFFLFdBQVc7b0JBQ3hCLGVBQWUsRUFBRSxXQUFXLElBQUksQ0FBQyxnQkFBZ0IsTUFBTTtpQkFDeEQ7YUFDRixDQUFDLENBQUM7WUFFSCxvREFBb0Q7WUFDcEQsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBQ2xELFFBQVEsQ0FBQyxTQUFTLENBQUMsS0FBSyxFQUFFLElBQUksVUFBVSxDQUFDLGlCQUFpQixDQUFDLEVBQUUsQ0FBQyxDQUFDLENBQUM7WUFDaEUsUUFBUSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUNuRSxDQUFDO1FBRUQsZ0JBQWdCO1FBQ2hCLElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsZUFBZSxFQUFFO1lBQ3ZDLEtBQUssRUFBRSxXQUFXLElBQUksQ0FBQyxnQkFBZ0IsTUFBTTtZQUM3QyxXQUFXLEVBQUUsc0JBQXNCO1lBQ25DLFVBQVUsRUFBRSxHQUFHLEVBQUUsZ0JBQWdCO1NBQ2xDLENBQUMsQ0FBQztRQUVILElBQUksR0FBRyxDQUFDLFNBQVMsQ0FBQyxJQUFJLEVBQUUsa0JBQWtCLEVBQUU7WUFDMUMsS0FBSyxFQUFFLElBQUksQ0FBQyxnQkFBZ0I7WUFDNUIsV0FBVyxFQUFFLGtDQUFrQztZQUMvQyxVQUFVLEVBQUUsR0FBRyxFQUFFLG1CQUFtQjtTQUNyQyxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUEzSUQsa0NBMklDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpR2F0ZXdheURvbWFpbjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50IH0gPSBwcm9wcztcbiAgICBjb25zdCBpc1Byb2QgPSBlbnZpcm9ubWVudCA9PT0gJ3Byb2QnO1xuXG4gICAgLy8gUmVwbyByb290IGlzIDMgbGV2ZWxzIHVwIGZyb20gaW5mcmEvbGliL3N0YWNrcy9cbiAgICBjb25zdCByZXBvUm9vdCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICcuLicpO1xuICAgIGNvbnN0IGxhbWJkYUJhc2VEaXIgPSBwYXRoLmpvaW4ocmVwb1Jvb3QsICdsYW1iZGEnKTtcblxuICAgIC8vIDEuIFJlZmVyZW5jZSBzZWNyZXRzIGZyb20gU2VjcmV0cyBNYW5hZ2VyXG4gICAgLy8gUGF0aDogU3ludGhldGljU3VwYWJhc2VBcHAvPGVudmlyb25tZW50Pi9zZWNyZXRzXG4gICAgY29uc3QgYXBwU2VjcmV0cyA9IHNlY3JldHNtYW5hZ2VyLlNlY3JldC5mcm9tU2VjcmV0TmFtZVYyKFxuICAgICAgdGhpcyxcbiAgICAgICdBcHBTZWNyZXRzJyxcbiAgICAgIGBTeW50aGV0aWNTdXBhYmFzZUFwcC8ke2Vudmlyb25tZW50fS9zZWNyZXRzYFxuICAgICk7XG5cbiAgICAvLyAyLiBDcmVhdGUgTGFtYmRhIGV4ZWN1dGlvbiByb2xlIHdpdGggQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlICsgU2VjcmV0cyBNYW5hZ2VyIHJlYWRcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgICdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ1xuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IFNlY3JldHMgTWFuYWdlciByZWFkIGFjY2VzcyB0byB0aGUgZXhlY3V0aW9uIHJvbGVcbiAgICBhcHBTZWNyZXRzLmdyYW50UmVhZChsYW1iZGFSb2xlKTtcblxuICAgIC8vIDMuIENyZWF0ZSBBUEkgR2F0ZXdheSBSZXN0QXBpIHdpdGggc3RhZ2UgXCJhcGlcIiwgQ2xvdWRXYXRjaCBsb2dnaW5nLCB0aHJvdHRsaW5nXG4gICAgY29uc3QgYXBpTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQXBpR2F0ZXdheUFjY2Vzc0xvZ3MnLCB7XG4gICAgICByZXRlbnRpb246IGlzUHJvZFxuICAgICAgICA/IGxvZ3MuUmV0ZW50aW9uRGF5cy5URU5fWUVBUlNcbiAgICAgICAgOiBsb2dzLlJldGVudGlvbkRheXMuT05FX1dFRUssXG4gICAgICByZW1vdmFsUG9saWN5OiBpc1Byb2RcbiAgICAgICAgPyBjZGsuUmVtb3ZhbFBvbGljeS5SRVRBSU5cbiAgICAgICAgOiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcGkgPSBuZXcgYXBpZ2F0ZXdheS5SZXN0QXBpKHRoaXMsICdBcHBBcGknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZGVzY3JpcHRpb246IGBBUEkgZm9yIHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAgKCR7ZW52aXJvbm1lbnR9KWAsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ2FwaScsXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKGFwaUxvZ0dyb3VwKSxcbiAgICAgICAgYWNjZXNzTG9nRm9ybWF0OiBhcGlnYXRld2F5LkFjY2Vzc0xvZ0Zvcm1hdC5qc29uV2l0aFN0YW5kYXJkRmllbGRzKCksXG4gICAgICAgIGxvZ2dpbmdMZXZlbDogYXBpZ2F0ZXdheS5NZXRob2RMb2dnaW5nTGV2ZWwuSU5GTyxcbiAgICAgICAgdGhyb3R0bGluZ1JhdGVMaW1pdDogMTAwLFxuICAgICAgICB0aHJvdHRsaW5nQnVyc3RMaW1pdDogMjAwLFxuICAgICAgfSxcbiAgICAgIC8vIE5vIENPUlMgY29uZmlnIG5lZWRlZCDigJQgQ2xvdWRGcm9udCBwcm94aWVzIC9hcGkvKiB0byBhdm9pZCBjcm9zcy1vcmlnaW4gaXNzdWVzXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaUdhdGV3YXlEb21haW4gPSBgJHt0aGlzLmFwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gO1xuXG4gICAgLy8gNC4gQXV0by1kaXNjb3ZlciBMYW1iZGEgZnVuY3Rpb25zIGZyb20gdGhlIGxhbWJkYS8gZGlyZWN0b3J5IGF0IHRoZSByZXBvIHJvb3QuXG4gICAgY29uc3QgZnVuY3Rpb25EaXJzID0gZnNcbiAgICAgIC5yZWFkZGlyU3luYyhsYW1iZGFCYXNlRGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSlcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgLm1hcCgoZW50cnkpID0+IGVudHJ5Lm5hbWUpO1xuXG4gICAgLy8gNS4gRm9yIGVhY2ggZnVuY3Rpb246IE5vZGVqc0Z1bmN0aW9uICsgQVBJIEdhdGV3YXkgcmVzb3VyY2UgKyBQT1NUL0dFVCBtZXRob2RzXG4gICAgZm9yIChjb25zdCBmbkRpciBvZiBmdW5jdGlvbkRpcnMpIHtcbiAgICAgIGNvbnN0IGVudHJ5RmlsZSA9IHBhdGguam9pbihsYW1iZGFCYXNlRGlyLCBmbkRpciwgJ2luZGV4LnRzJyk7XG4gICAgICBpZiAoIWZzLmV4aXN0c1N5bmMoZW50cnlGaWxlKSkgY29udGludWU7XG5cbiAgICAgIC8vIENvbnZlcnQga2ViYWItY2FzZSBkaXJlY3RvcnkgbmFtZSB0byBQYXNjYWxDYXNlIGZvciBDREsgbG9naWNhbCBJRHNcbiAgICAgIC8vIGUuZy4gaGVsbG8td29ybGQg4oaSIEhlbGxvV29ybGQsIHByb2Nlc3MtcGF5bWVudCDihpIgUHJvY2Vzc1BheW1lbnRcbiAgICAgIGNvbnN0IGxvZ2ljYWxJZCA9IGZuRGlyXG4gICAgICAgIC5zcGxpdCgnLScpXG4gICAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJ0LnNsaWNlKDEpKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICAgIC8vIExvZyBncm91cCBmb3IgZWFjaCBMYW1iZGEgZnVuY3Rpb25cbiAgICAgIGNvbnN0IGZuTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBgJHtsb2dpY2FsSWR9TG9nR3JvdXBgLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhL3N5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICByZXRlbnRpb246IGlzUHJvZFxuICAgICAgICAgID8gbG9ncy5SZXRlbnRpb25EYXlzLlRFTl9ZRUFSU1xuICAgICAgICAgIDogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLLFxuICAgICAgICByZW1vdmFsUG9saWN5OiBpc1Byb2RcbiAgICAgICAgICA/IGNkay5SZW1vdmFsUG9saWN5LlJFVEFJTlxuICAgICAgICAgIDogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBgJHtsb2dpY2FsSWR9RnVuY3Rpb25gLCB7XG4gICAgICAgIGZ1bmN0aW9uTmFtZTogYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICBydW50aW1lOiBsYW1iZGEuUnVudGltZS5OT0RFSlNfTEFURVNULFxuICAgICAgICB0aW1lb3V0OiBjZGsuRHVyYXRpb24uc2Vjb25kcygzMCksXG4gICAgICAgIG1lbW9yeVNpemU6IDUxMixcbiAgICAgICAgcm9sZTogbGFtYmRhUm9sZSxcbiAgICAgICAgZW50cnk6IGVudHJ5RmlsZSxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICAvLyBwcm9qZWN0Um9vdCBtdXN0IGJlIHNldCB0byByZXBvIHJvb3Qgc28gTm9kZWpzRnVuY3Rpb24gY2FuIGxvY2F0ZVxuICAgICAgICAvLyB0aGUgZW50cnkgZmlsZSBvdXRzaWRlIHRoZSBpbmZyYS8gQ0RLIHByb2plY3QgZGlyZWN0b3J5XG4gICAgICAgIHByb2plY3RSb290OiByZXBvUm9vdCxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICAgIHRhcmdldDogJ2VzMjAyMicsXG4gICAgICAgICAgLy8gQnVuZGxlIGFsbCBhcHAgZGVwZW5kZW5jaWVzOyBtYXJrIEFXUyBTREsgcGFja2FnZXMgYXMgZXh0ZXJuYWxcbiAgICAgICAgICAvLyAodGhleSBhcmUgcHJvdmlkZWQgYnkgdGhlIExhbWJkYSBydW50aW1lIGZvciBOT0RFSlNfTEFURVNUKVxuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogW1xuICAgICAgICAgICAgJ0Bhd3Mtc2RrLyonLFxuICAgICAgICAgICAgJ0BzbWl0aHkvKicsXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nR3JvdXA6IGZuTG9nR3JvdXAsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICBBUElfR0FURVdBWV9VUkw6IGBodHRwczovLyR7dGhpcy5hcGlHYXRld2F5RG9tYWlufS9hcGlgLFxuICAgICAgICB9LFxuICAgICAgfSk7XG5cbiAgICAgIC8vIEFkZCBBUEkgR2F0ZXdheSByZXNvdXJjZSBhbmQgbWV0aG9kcyAoR0VUICsgUE9TVClcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShmbkRpcik7XG4gICAgICByZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGZuKSk7XG4gICAgICByZXNvdXJjZS5hZGRNZXRob2QoJ1BPU1QnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihmbikpO1xuICAgIH1cblxuICAgIC8vIFN0YWNrIG91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQXBpR2F0ZXdheVVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMuYXBpR2F0ZXdheURvbWFpbn0vYXBpYCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgYmFzZSBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYCR7aWR9LUFwaUdhdGV3YXlVcmxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlEb21haW4nLCB7XG4gICAgICB2YWx1ZTogdGhpcy5hcGlHYXRld2F5RG9tYWluLFxuICAgICAgZGVzY3JpcHRpb246ICdBUEkgR2F0ZXdheSBkb21haW4gKG5vIHByb3RvY29sKScsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tQXBpR2F0ZXdheURvbWFpbmAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==