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
        // 1. Reference the secret in Secrets Manager
        // Secret name pattern: <AppName>/<environment>/secrets
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `synthetic-supabase-app/${environment}/secrets`);
        // 2. Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant read access to the secret
        appSecrets.grantRead(lambdaRole);
        // 3. Log retention: 10 years for prod, 1 week for non-prod
        const logRetentionDays = environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK;
        // 4. Create API Gateway RestApi with stage "api", CloudWatch logging, and throttling
        //    No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
            retention: logRetentionDays,
        });
        this.api = new apigateway.RestApi(this, 'ApiGateway', {
            restApiName: `synthetic-supabase-app-${environment}`,
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
        // 5. Auto-discover functions from the lambda/ directory
        // __dirname = infra/lib/stacks  →  ../../../ = repo root
        const repoRoot = path.join(__dirname, '..', '..', '..');
        const lambdaDir = path.join(repoRoot, 'lambda');
        const functionDirs = fs.readdirSync(lambdaDir).filter((entry) => {
            const entryPath = path.join(lambdaDir, entry);
            return fs.statSync(entryPath).isDirectory();
        });
        // 6. For each function directory: create NodejsFunction + API Gateway resource + methods
        for (const funcDir of functionDirs) {
            // Convert directory name to PascalCase logical ID (e.g., "hello-world" -> "HelloWorld")
            const logicalId = funcDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            const entryFile = path.join(lambdaDir, funcDir, 'index.ts');
            // Create a dedicated CloudWatch log group for each Lambda function
            const fnLogGroup = new logs.LogGroup(this, `${logicalId}LogGroup`, {
                logGroupName: `/aws/lambda/synthetic-supabase-app-${environment}-${funcDir}`,
                retention: logRetentionDays,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${logicalId}Function`, {
                functionName: `synthetic-supabase-app-${environment}-${funcDir}`,
                runtime: lambda.Runtime.NODEJS_LATEST,
                handler: 'handler',
                entry: entryFile,
                // projectRoot must encompass the entry file (which lives outside infra/)
                projectRoot: repoRoot,
                // depsLockFilePath must also be under projectRoot
                depsLockFilePath: path.join(lambdaDir, funcDir, 'package.json'),
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                bundling: {
                    minify: true,
                    sourceMap: false,
                    target: 'es2022',
                    externalModules: [],
                },
                logGroup: fnLogGroup,
            });
            // Create an API Gateway resource for this function using the directory name as the path segment
            const resource = this.api.root.addResource(funcDir);
            // Support both GET and POST methods
            resource.addMethod('GET', new apigateway.LambdaIntegration(fn));
            resource.addMethod('POST', new apigateway.LambdaIntegration(fn));
        }
        // 7. Outputs
        new cdk.CfnOutput(this, 'ApiGatewayUrl', {
            value: `https://${this.apiGatewayDomain}/api`,
            description: 'API Gateway base URL',
        });
        new cdk.CfnOutput(this, 'ApiGatewayDomain', {
            value: this.apiGatewayDomain,
            description: 'API Gateway domain (used by CloudFront origin)',
        });
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlCLDZDQUE2QztRQUM3Qyx1REFBdUQ7UUFDdkQsTUFBTSxVQUFVLEdBQUcsY0FBYyxDQUFDLE1BQU0sQ0FBQyxnQkFBZ0IsQ0FDdkQsSUFBSSxFQUNKLFlBQVksRUFDWiwwQkFBMEIsV0FBVyxVQUFVLENBQ2hELENBQUM7UUFFRixtRkFBbUY7UUFDbkYsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQUMsMENBQTBDLENBQUM7YUFDdkY7U0FDRixDQUFDLENBQUM7UUFFSCxrQ0FBa0M7UUFDbEMsVUFBVSxDQUFDLFNBQVMsQ0FBQyxVQUFVLENBQUMsQ0FBQztRQUVqQywyREFBMkQ7UUFDM0QsTUFBTSxnQkFBZ0IsR0FBRyxX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LEVBQUU7WUFDdkMsS0FBSyxFQUFFLFdBQVcsSUFBSSxDQUFDLGdCQUFnQixNQUFNO1lBQzdDLFdBQVcsRUFBRSxzQkFBc0I7U0FDcEMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxrQkFBa0IsRUFBRTtZQUMxQyxLQUFLLEVBQUUsSUFBSSxDQUFDLGdCQUFnQjtZQUM1QixXQUFXLEVBQUUsZ0RBQWdEO1NBQzlELENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdIRCxrQ0E2SEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTGFtYmRhU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gIHB1YmxpYyByZWFkb25seSBhcGlHYXRld2F5RG9tYWluOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gMS4gUmVmZXJlbmNlIHRoZSBzZWNyZXQgaW4gU2VjcmV0cyBNYW5hZ2VyXG4gICAgLy8gU2VjcmV0IG5hbWUgcGF0dGVybjogPEFwcE5hbWU+LzxlbnZpcm9ubWVudD4vc2VjcmV0c1xuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICAgIHRoaXMsXG4gICAgICAnQXBwU2VjcmV0cycsXG4gICAgICBgc3ludGhldGljLXN1cGFiYXNlLWFwcC8ke2Vudmlyb25tZW50fS9zZWNyZXRzYCxcbiAgICApO1xuXG4gICAgLy8gMi4gTGFtYmRhIGV4ZWN1dGlvbiByb2xlIHdpdGggQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlICsgU2VjcmV0cyBNYW5hZ2VyIHJlYWRcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKCdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJyksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgcmVhZCBhY2Nlc3MgdG8gdGhlIHNlY3JldFxuICAgIGFwcFNlY3JldHMuZ3JhbnRSZWFkKGxhbWJkYVJvbGUpO1xuXG4gICAgLy8gMy4gTG9nIHJldGVudGlvbjogMTAgeWVhcnMgZm9yIHByb2QsIDEgd2VlayBmb3Igbm9uLXByb2RcbiAgICBjb25zdCBsb2dSZXRlbnRpb25EYXlzID0gZW52aXJvbm1lbnQgPT09ICdwcm9kJ1xuICAgICAgPyBsb2dzLlJldGVudGlvbkRheXMuVEVOX1lFQVJTXG4gICAgICA6IGxvZ3MuUmV0ZW50aW9uRGF5cy5PTkVfV0VFSztcblxuICAgIC8vIDQuIENyZWF0ZSBBUEkgR2F0ZXdheSBSZXN0QXBpIHdpdGggc3RhZ2UgXCJhcGlcIiwgQ2xvdWRXYXRjaCBsb2dnaW5nLCBhbmQgdGhyb3R0bGluZ1xuICAgIC8vICAgIE5vIENPUlMgY29uZmlnIG5lZWRlZCDigJQgQ2xvdWRGcm9udCBwcm94aWVzIC9hcGkvKiB0byBhdm9pZCBjcm9zcy1vcmlnaW4gaXNzdWVzXG4gICAgY29uc3QgYXBpTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCAnQXBpR2F0ZXdheUFjY2Vzc0xvZ3MnLCB7XG4gICAgICByZXRlbnRpb246IGxvZ1JldGVudGlvbkRheXMsXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaSA9IG5ldyBhcGlnYXRld2F5LlJlc3RBcGkodGhpcywgJ0FwaUdhdGV3YXknLCB7XG4gICAgICByZXN0QXBpTmFtZTogYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgZGVwbG95T3B0aW9uczoge1xuICAgICAgICBzdGFnZU5hbWU6ICdhcGknLFxuICAgICAgICBhY2Nlc3NMb2dEZXN0aW5hdGlvbjogbmV3IGFwaWdhdGV3YXkuTG9nR3JvdXBMb2dEZXN0aW5hdGlvbihhcGlMb2dHcm91cCksXG4gICAgICAgIGFjY2Vzc0xvZ0Zvcm1hdDogYXBpZ2F0ZXdheS5BY2Nlc3NMb2dGb3JtYXQuanNvbldpdGhTdGFuZGFyZEZpZWxkcygpLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAyMDAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgdGhpcy5hcGlHYXRld2F5RG9tYWluID0gYCR7dGhpcy5hcGkucmVzdEFwaUlkfS5leGVjdXRlLWFwaS4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcblxuICAgIC8vIDUuIEF1dG8tZGlzY292ZXIgZnVuY3Rpb25zIGZyb20gdGhlIGxhbWJkYS8gZGlyZWN0b3J5XG4gICAgLy8gX19kaXJuYW1lID0gaW5mcmEvbGliL3N0YWNrcyAg4oaSICAuLi8uLi8uLi8gPSByZXBvIHJvb3RcbiAgICBjb25zdCByZXBvUm9vdCA9IHBhdGguam9pbihfX2Rpcm5hbWUsICcuLicsICcuLicsICcuLicpO1xuICAgIGNvbnN0IGxhbWJkYURpciA9IHBhdGguam9pbihyZXBvUm9vdCwgJ2xhbWJkYScpO1xuICAgIGNvbnN0IGZ1bmN0aW9uRGlycyA9IGZzLnJlYWRkaXJTeW5jKGxhbWJkYURpcikuZmlsdGVyKChlbnRyeSkgPT4ge1xuICAgICAgY29uc3QgZW50cnlQYXRoID0gcGF0aC5qb2luKGxhbWJkYURpciwgZW50cnkpO1xuICAgICAgcmV0dXJuIGZzLnN0YXRTeW5jKGVudHJ5UGF0aCkuaXNEaXJlY3RvcnkoKTtcbiAgICB9KTtcblxuICAgIC8vIDYuIEZvciBlYWNoIGZ1bmN0aW9uIGRpcmVjdG9yeTogY3JlYXRlIE5vZGVqc0Z1bmN0aW9uICsgQVBJIEdhdGV3YXkgcmVzb3VyY2UgKyBtZXRob2RzXG4gICAgZm9yIChjb25zdCBmdW5jRGlyIG9mIGZ1bmN0aW9uRGlycykge1xuICAgICAgLy8gQ29udmVydCBkaXJlY3RvcnkgbmFtZSB0byBQYXNjYWxDYXNlIGxvZ2ljYWwgSUQgKGUuZy4sIFwiaGVsbG8td29ybGRcIiAtPiBcIkhlbGxvV29ybGRcIilcbiAgICAgIGNvbnN0IGxvZ2ljYWxJZCA9IGZ1bmNEaXJcbiAgICAgICAgLnNwbGl0KCctJylcbiAgICAgICAgLm1hcCgocGFydCkgPT4gcGFydC5jaGFyQXQoMCkudG9VcHBlckNhc2UoKSArIHBhcnQuc2xpY2UoMSkpXG4gICAgICAgIC5qb2luKCcnKTtcblxuICAgICAgY29uc3QgZW50cnlGaWxlID0gcGF0aC5qb2luKGxhbWJkYURpciwgZnVuY0RpciwgJ2luZGV4LnRzJyk7XG5cbiAgICAgIC8vIENyZWF0ZSBhIGRlZGljYXRlZCBDbG91ZFdhdGNoIGxvZyBncm91cCBmb3IgZWFjaCBMYW1iZGEgZnVuY3Rpb25cbiAgICAgIGNvbnN0IGZuTG9nR3JvdXAgPSBuZXcgbG9ncy5Mb2dHcm91cCh0aGlzLCBgJHtsb2dpY2FsSWR9TG9nR3JvdXBgLCB7XG4gICAgICAgIGxvZ0dyb3VwTmFtZTogYC9hd3MvbGFtYmRhL3N5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH0tJHtmdW5jRGlyfWAsXG4gICAgICAgIHJldGVudGlvbjogbG9nUmV0ZW50aW9uRGF5cyxcbiAgICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICAgIH0pO1xuXG4gICAgICBjb25zdCBmbiA9IG5ldyBOb2RlanNGdW5jdGlvbih0aGlzLCBgJHtsb2dpY2FsSWR9RnVuY3Rpb25gLCB7XG4gICAgICAgIGZ1bmN0aW9uTmFtZTogYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH0tJHtmdW5jRGlyfWAsXG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU19MQVRFU1QsXG4gICAgICAgIGhhbmRsZXI6ICdoYW5kbGVyJyxcbiAgICAgICAgZW50cnk6IGVudHJ5RmlsZSxcbiAgICAgICAgLy8gcHJvamVjdFJvb3QgbXVzdCBlbmNvbXBhc3MgdGhlIGVudHJ5IGZpbGUgKHdoaWNoIGxpdmVzIG91dHNpZGUgaW5mcmEvKVxuICAgICAgICBwcm9qZWN0Um9vdDogcmVwb1Jvb3QsXG4gICAgICAgIC8vIGRlcHNMb2NrRmlsZVBhdGggbXVzdCBhbHNvIGJlIHVuZGVyIHByb2plY3RSb290XG4gICAgICAgIGRlcHNMb2NrRmlsZVBhdGg6IHBhdGguam9pbihsYW1iZGFEaXIsIGZ1bmNEaXIsICdwYWNrYWdlLmpzb24nKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICBBUElfR0FURVdBWV9VUkw6IGBodHRwczovLyR7dGhpcy5hcGlHYXRld2F5RG9tYWlufS9hcGlgLFxuICAgICAgICB9LFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2VNYXA6IGZhbHNlLFxuICAgICAgICAgIHRhcmdldDogJ2VzMjAyMicsXG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbXSxcbiAgICAgICAgfSxcbiAgICAgICAgbG9nR3JvdXA6IGZuTG9nR3JvdXAsXG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIGFuIEFQSSBHYXRld2F5IHJlc291cmNlIGZvciB0aGlzIGZ1bmN0aW9uIHVzaW5nIHRoZSBkaXJlY3RvcnkgbmFtZSBhcyB0aGUgcGF0aCBzZWdtZW50XG4gICAgICBjb25zdCByZXNvdXJjZSA9IHRoaXMuYXBpLnJvb3QuYWRkUmVzb3VyY2UoZnVuY0Rpcik7XG5cbiAgICAgIC8vIFN1cHBvcnQgYm90aCBHRVQgYW5kIFBPU1QgbWV0aG9kc1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKCdHRVQnLCBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihmbikpO1xuICAgICAgcmVzb3VyY2UuYWRkTWV0aG9kKCdQT1NUJywgbmV3IGFwaWdhdGV3YXkuTGFtYmRhSW50ZWdyYXRpb24oZm4pKTtcbiAgICB9XG5cbiAgICAvLyA3LiBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0FwaUdhdGV3YXlVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHt0aGlzLmFwaUdhdGV3YXlEb21haW59L2FwaWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0FQSSBHYXRld2F5IGJhc2UgVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdBcGlHYXRld2F5RG9tYWluJywge1xuICAgICAgdmFsdWU6IHRoaXMuYXBpR2F0ZXdheURvbWFpbixcbiAgICAgIGRlc2NyaXB0aW9uOiAnQVBJIEdhdGV3YXkgZG9tYWluICh1c2VkIGJ5IENsb3VkRnJvbnQgb3JpZ2luKScsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==