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
        // 1. Reference secrets from Secrets Manager
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `App/${environment}/secrets`);
        // 2. Create Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant Secrets Manager read access
        appSecrets.grantRead(lambdaRole);
        // 3. Log retention: 10 years for prod, 1 week for non-prod
        const logRetentionDays = environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK;
        // 4. Create API Gateway RestApi with stage "api", CloudWatch logging, throttling
        //    Note: No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
        this.api = new apigateway.RestApi(this, 'ApiGateway', {
            restApiName: `App-${environment}-api`,
            description: `API Gateway for App (${environment})`,
            deployOptions: {
                stageName: 'api',
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                metricsEnabled: true,
            },
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // 5. Auto-discover functions from lambda/ directory
        // repoRoot is one level up from infra/
        const repoRoot = path.join(__dirname, '..', '..', '..');
        const lambdaRootDir = path.join(repoRoot, 'lambda');
        const functionDirs = fs
            .readdirSync(lambdaRootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // 6. For each function: NodejsFunction with esbuild bundling + API Gateway resource + methods
        for (const fnDir of functionDirs) {
            const fnProjectRoot = path.join(lambdaRootDir, fnDir);
            const entryFile = path.join(fnProjectRoot, 'index.ts');
            const depsLockFilePath = path.join(fnProjectRoot, 'package-lock.json');
            // Convert kebab-case dir name to PascalCase for CDK construct IDs
            const constructId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            // Create a dedicated log group for this function
            const logGroup = new logs.LogGroup(this, `${constructId}LogGroup`, {
                logGroupName: `/aws/lambda/App-${environment}-${fnDir}`,
                retention: logRetentionDays,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            // Create the Lambda function using NodejsFunction (auto-bundles TypeScript with esbuild)
            // projectRoot and depsLockFilePath point to the function's own directory
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${constructId}Function`, {
                functionName: `App-${environment}-${fnDir}`,
                entry: entryFile,
                handler: 'handler',
                runtime: lambda.Runtime.NODEJS_LATEST,
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                logGroup,
                projectRoot: fnProjectRoot,
                depsLockFilePath,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                bundling: {
                    minify: true,
                    sourceMap: true,
                    target: 'es2022',
                    // @aws-sdk/* is available in the Lambda NODEJS_LATEST runtime
                    // All other dependencies (e.g. @supabase/supabase-js) are bundled
                    externalModules: ['@aws-sdk/*'],
                },
            });
            // Create API Gateway resource path from the directory name
            const resource = this.api.root.addResource(fnDir);
            // Add GET and POST methods
            const integration = new apigateway.LambdaIntegration(fn, {
                proxy: true,
            });
            resource.addMethod('GET', integration);
            resource.addMethod('POST', integration);
        }
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlCLDRDQUE0QztRQUM1QyxNQUFNLFVBQVUsR0FBRyxjQUFjLENBQUMsTUFBTSxDQUFDLGdCQUFnQixDQUN2RCxJQUFJLEVBQ0osWUFBWSxFQUNaLE9BQU8sV0FBVyxVQUFVLENBQzdCLENBQUM7UUFFRiwwRkFBMEY7UUFDMUYsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDBDQUEwQyxDQUMzQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsb0NBQW9DO1FBQ3BDLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFakMsMkRBQTJEO1FBQzNELE1BQU0sZ0JBQWdCLEdBQ3BCLFdBQVcsS0FBSyxNQUFN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QUMsT0FBTyxDQUFDLGFBQWE7Z0JBQ3JDLE9BQU8sRUFBRSxHQUFHLENBQUMsUUFBUSxDQUFDLE9BQU8sQ0FBQyxFQUFFLENBQUM7Z0JBQ2pDLFVBQVUsRUFBRSxHQUFHO2dCQUNmLElBQUksRUFBRSxVQUFVO2dCQUNoQixRQUFRO2dCQUNSLFdBQVcsRUFBRSxhQUFhO2dCQUMxQixnQkFBZ0I7Z0JBQ2hCLFdBQVcsRUFBRTtvQkFDWCxXQUFXLEVBQUUsVUFBVSxDQUFDLFNBQVM7b0JBQ2pDLFdBQVcsRUFBRSxXQUFXO29CQUN4QixlQUFlLEVBQUUsV0FBVyxJQUFJLENBQUMsZ0JBQWdCLE1BQU07aUJBQ3hEO2dCQUNELFFBQVEsRUFBRTtvQkFDUixNQUFNLEVBQUUsSUFBSTtvQkFDWixTQUFTLEVBQUUsSUFBSTtvQkFDZixNQUFNLEVBQUUsUUFBUTtvQkFDaEIsOERBQThEO29CQUM5RCxrRUFBa0U7b0JBQ2xFLGVBQWUsRUFBRSxDQUFDLFlBQVksQ0FBQztpQkFDaEM7YUFDRixDQUFDLENBQUM7WUFFSCwyREFBMkQ7WUFDM0QsTUFBTSxRQUFRLEdBQUcsSUFBSSxDQUFDLEdBQUcsQ0FBQyxJQUFJLENBQUMsV0FBVyxDQUFDLEtBQUssQ0FBQyxDQUFDO1lBRWxELDJCQUEyQjtZQUMzQixNQUFNLFdBQVcsR0FBRyxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLEVBQUU7Z0JBQ3ZELEtBQUssRUFBRSxJQUFJO2FBQ1osQ0FBQyxDQUFDO1lBRUgsUUFBUSxDQUFDLFNBQVMsQ0FBQyxLQUFLLEVBQUUsV0FBVyxDQUFDLENBQUM7WUFDdkMsUUFBUSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsV0FBVyxDQUFDLENBQUM7UUFDMUMsQ0FBQztJQUNILENBQUM7Q0FDRjtBQXhIRCxrQ0F3SEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgbGFtYmRhIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sYW1iZGEnO1xuaW1wb3J0IHsgTm9kZWpzRnVuY3Rpb24gfSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhLW5vZGVqcyc7XG5pbXBvcnQgKiBhcyBhcGlnYXRld2F5IGZyb20gJ2F3cy1jZGstbGliL2F3cy1hcGlnYXRld2F5JztcbmltcG9ydCAqIGFzIHNlY3JldHNtYW5hZ2VyIGZyb20gJ2F3cy1jZGstbGliL2F3cy1zZWNyZXRzbWFuYWdlcic7XG5pbXBvcnQgKiBhcyBpYW0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWlhbSc7XG5pbXBvcnQgKiBhcyBsb2dzIGZyb20gJ2F3cy1jZGstbGliL2F3cy1sb2dzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgZnMgZnJvbSAnZnMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBMYW1iZGFTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgTGFtYmRhU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpOiBhcGlnYXRld2F5LlJlc3RBcGk7XG4gIHB1YmxpYyByZWFkb25seSBhcGlHYXRld2F5RG9tYWluOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IExhbWJkYVN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQgfSA9IHByb3BzO1xuXG4gICAgLy8gMS4gUmVmZXJlbmNlIHNlY3JldHMgZnJvbSBTZWNyZXRzIE1hbmFnZXJcbiAgICBjb25zdCBhcHBTZWNyZXRzID0gc2VjcmV0c21hbmFnZXIuU2VjcmV0LmZyb21TZWNyZXROYW1lVjIoXG4gICAgICB0aGlzLFxuICAgICAgJ0FwcFNlY3JldHMnLFxuICAgICAgYEFwcC8ke2Vudmlyb25tZW50fS9zZWNyZXRzYFxuICAgICk7XG5cbiAgICAvLyAyLiBDcmVhdGUgTGFtYmRhIGV4ZWN1dGlvbiByb2xlIHdpdGggQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlICsgU2VjcmV0cyBNYW5hZ2VyIHJlYWRcbiAgICBjb25zdCBsYW1iZGFSb2xlID0gbmV3IGlhbS5Sb2xlKHRoaXMsICdMYW1iZGFFeGVjdXRpb25Sb2xlJywge1xuICAgICAgYXNzdW1lZEJ5OiBuZXcgaWFtLlNlcnZpY2VQcmluY2lwYWwoJ2xhbWJkYS5hbWF6b25hd3MuY29tJyksXG4gICAgICBtYW5hZ2VkUG9saWNpZXM6IFtcbiAgICAgICAgaWFtLk1hbmFnZWRQb2xpY3kuZnJvbUF3c01hbmFnZWRQb2xpY3lOYW1lKFxuICAgICAgICAgICdzZXJ2aWNlLXJvbGUvQVdTTGFtYmRhQmFzaWNFeGVjdXRpb25Sb2xlJ1xuICAgICAgICApLFxuICAgICAgXSxcbiAgICB9KTtcblxuICAgIC8vIEdyYW50IFNlY3JldHMgTWFuYWdlciByZWFkIGFjY2Vzc1xuICAgIGFwcFNlY3JldHMuZ3JhbnRSZWFkKGxhbWJkYVJvbGUpO1xuXG4gICAgLy8gMy4gTG9nIHJldGVudGlvbjogMTAgeWVhcnMgZm9yIHByb2QsIDEgd2VlayBmb3Igbm9uLXByb2RcbiAgICBjb25zdCBsb2dSZXRlbnRpb25EYXlzID1cbiAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgPyBsb2dzLlJldGVudGlvbkRheXMuVEVOX1lFQVJTXG4gICAgICAgIDogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLO1xuXG4gICAgLy8gNC4gQ3JlYXRlIEFQSSBHYXRld2F5IFJlc3RBcGkgd2l0aCBzdGFnZSBcImFwaVwiLCBDbG91ZFdhdGNoIGxvZ2dpbmcsIHRocm90dGxpbmdcbiAgICAvLyAgICBOb3RlOiBObyBDT1JTIGNvbmZpZyBuZWVkZWQg4oCUIENsb3VkRnJvbnQgcHJveGllcyAvYXBpLyogdG8gYXZvaWQgY3Jvc3Mtb3JpZ2luIGlzc3Vlc1xuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBpR2F0ZXdheScsIHtcbiAgICAgIHJlc3RBcGlOYW1lOiBgQXBwLSR7ZW52aXJvbm1lbnR9LWFwaWAsXG4gICAgICBkZXNjcmlwdGlvbjogYEFQSSBHYXRld2F5IGZvciBBcHAgKCR7ZW52aXJvbm1lbnR9KWAsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ2FwaScsXG4gICAgICAgIHRocm90dGxpbmdSYXRlTGltaXQ6IDEwMCxcbiAgICAgICAgdGhyb3R0bGluZ0J1cnN0TGltaXQ6IDIwMCxcbiAgICAgICAgbG9nZ2luZ0xldmVsOiBhcGlnYXRld2F5Lk1ldGhvZExvZ2dpbmdMZXZlbC5JTkZPLFxuICAgICAgICBtZXRyaWNzRW5hYmxlZDogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICB0aGlzLmFwaUdhdGV3YXlEb21haW4gPSBgJHt0aGlzLmFwaS5yZXN0QXBpSWR9LmV4ZWN1dGUtYXBpLiR7dGhpcy5yZWdpb259LmFtYXpvbmF3cy5jb21gO1xuXG4gICAgLy8gNS4gQXV0by1kaXNjb3ZlciBmdW5jdGlvbnMgZnJvbSBsYW1iZGEvIGRpcmVjdG9yeVxuICAgIC8vIHJlcG9Sb290IGlzIG9uZSBsZXZlbCB1cCBmcm9tIGluZnJhL1xuICAgIGNvbnN0IHJlcG9Sb290ID0gcGF0aC5qb2luKF9fZGlybmFtZSwgJy4uJywgJy4uJywgJy4uJyk7XG4gICAgY29uc3QgbGFtYmRhUm9vdERpciA9IHBhdGguam9pbihyZXBvUm9vdCwgJ2xhbWJkYScpO1xuXG4gICAgY29uc3QgZnVuY3Rpb25EaXJzID0gZnNcbiAgICAgIC5yZWFkZGlyU3luYyhsYW1iZGFSb290RGlyLCB7IHdpdGhGaWxlVHlwZXM6IHRydWUgfSlcbiAgICAgIC5maWx0ZXIoKGVudHJ5KSA9PiBlbnRyeS5pc0RpcmVjdG9yeSgpKVxuICAgICAgLm1hcCgoZW50cnkpID0+IGVudHJ5Lm5hbWUpO1xuXG4gICAgLy8gNi4gRm9yIGVhY2ggZnVuY3Rpb246IE5vZGVqc0Z1bmN0aW9uIHdpdGggZXNidWlsZCBidW5kbGluZyArIEFQSSBHYXRld2F5IHJlc291cmNlICsgbWV0aG9kc1xuICAgIGZvciAoY29uc3QgZm5EaXIgb2YgZnVuY3Rpb25EaXJzKSB7XG4gICAgICBjb25zdCBmblByb2plY3RSb290ID0gcGF0aC5qb2luKGxhbWJkYVJvb3REaXIsIGZuRGlyKTtcbiAgICAgIGNvbnN0IGVudHJ5RmlsZSA9IHBhdGguam9pbihmblByb2plY3RSb290LCAnaW5kZXgudHMnKTtcbiAgICAgIGNvbnN0IGRlcHNMb2NrRmlsZVBhdGggPSBwYXRoLmpvaW4oZm5Qcm9qZWN0Um9vdCwgJ3BhY2thZ2UtbG9jay5qc29uJyk7XG5cbiAgICAgIC8vIENvbnZlcnQga2ViYWItY2FzZSBkaXIgbmFtZSB0byBQYXNjYWxDYXNlIGZvciBDREsgY29uc3RydWN0IElEc1xuICAgICAgY29uc3QgY29uc3RydWN0SWQgPSBmbkRpclxuICAgICAgICAuc3BsaXQoJy0nKVxuICAgICAgICAubWFwKChwYXJ0KSA9PiBwYXJ0LmNoYXJBdCgwKS50b1VwcGVyQ2FzZSgpICsgcGFydC5zbGljZSgxKSlcbiAgICAgICAgLmpvaW4oJycpO1xuXG4gICAgICAvLyBDcmVhdGUgYSBkZWRpY2F0ZWQgbG9nIGdyb3VwIGZvciB0aGlzIGZ1bmN0aW9uXG4gICAgICBjb25zdCBsb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsIGAke2NvbnN0cnVjdElkfUxvZ0dyb3VwYCwge1xuICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2xhbWJkYS9BcHAtJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICByZXRlbnRpb246IGxvZ1JldGVudGlvbkRheXMsXG4gICAgICAgIHJlbW92YWxQb2xpY3k6IGNkay5SZW1vdmFsUG9saWN5LkRFU1RST1ksXG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIHRoZSBMYW1iZGEgZnVuY3Rpb24gdXNpbmcgTm9kZWpzRnVuY3Rpb24gKGF1dG8tYnVuZGxlcyBUeXBlU2NyaXB0IHdpdGggZXNidWlsZClcbiAgICAgIC8vIHByb2plY3RSb290IGFuZCBkZXBzTG9ja0ZpbGVQYXRoIHBvaW50IHRvIHRoZSBmdW5jdGlvbidzIG93biBkaXJlY3RvcnlcbiAgICAgIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIGAke2NvbnN0cnVjdElkfUZ1bmN0aW9uYCwge1xuICAgICAgICBmdW5jdGlvbk5hbWU6IGBBcHAtJHtlbnZpcm9ubWVudH0tJHtmbkRpcn1gLFxuICAgICAgICBlbnRyeTogZW50cnlGaWxlLFxuICAgICAgICBoYW5kbGVyOiAnaGFuZGxlcicsXG4gICAgICAgIHJ1bnRpbWU6IGxhbWJkYS5SdW50aW1lLk5PREVKU19MQVRFU1QsXG4gICAgICAgIHRpbWVvdXQ6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDMwKSxcbiAgICAgICAgbWVtb3J5U2l6ZTogNTEyLFxuICAgICAgICByb2xlOiBsYW1iZGFSb2xlLFxuICAgICAgICBsb2dHcm91cCxcbiAgICAgICAgcHJvamVjdFJvb3Q6IGZuUHJvamVjdFJvb3QsXG4gICAgICAgIGRlcHNMb2NrRmlsZVBhdGgsXG4gICAgICAgIGVudmlyb25tZW50OiB7XG4gICAgICAgICAgU0VDUkVUU19BUk46IGFwcFNlY3JldHMuc2VjcmV0QXJuLFxuICAgICAgICAgIEVOVklST05NRU5UOiBlbnZpcm9ubWVudCxcbiAgICAgICAgICBBUElfR0FURVdBWV9VUkw6IGBodHRwczovLyR7dGhpcy5hcGlHYXRld2F5RG9tYWlufS9hcGlgLFxuICAgICAgICB9LFxuICAgICAgICBidW5kbGluZzoge1xuICAgICAgICAgIG1pbmlmeTogdHJ1ZSxcbiAgICAgICAgICBzb3VyY2VNYXA6IHRydWUsXG4gICAgICAgICAgdGFyZ2V0OiAnZXMyMDIyJyxcbiAgICAgICAgICAvLyBAYXdzLXNkay8qIGlzIGF2YWlsYWJsZSBpbiB0aGUgTGFtYmRhIE5PREVKU19MQVRFU1QgcnVudGltZVxuICAgICAgICAgIC8vIEFsbCBvdGhlciBkZXBlbmRlbmNpZXMgKGUuZy4gQHN1cGFiYXNlL3N1cGFiYXNlLWpzKSBhcmUgYnVuZGxlZFxuICAgICAgICAgIGV4dGVybmFsTW9kdWxlczogWydAYXdzLXNkay8qJ10sXG4gICAgICAgIH0sXG4gICAgICB9KTtcblxuICAgICAgLy8gQ3JlYXRlIEFQSSBHYXRld2F5IHJlc291cmNlIHBhdGggZnJvbSB0aGUgZGlyZWN0b3J5IG5hbWVcbiAgICAgIGNvbnN0IHJlc291cmNlID0gdGhpcy5hcGkucm9vdC5hZGRSZXNvdXJjZShmbkRpcik7XG5cbiAgICAgIC8vIEFkZCBHRVQgYW5kIFBPU1QgbWV0aG9kc1xuICAgICAgY29uc3QgaW50ZWdyYXRpb24gPSBuZXcgYXBpZ2F0ZXdheS5MYW1iZGFJbnRlZ3JhdGlvbihmbiwge1xuICAgICAgICBwcm94eTogdHJ1ZSxcbiAgICAgIH0pO1xuXG4gICAgICByZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIGludGVncmF0aW9uKTtcbiAgICAgIHJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIGludGVncmF0aW9uKTtcbiAgICB9XG4gIH1cbn1cbiJdfQ==