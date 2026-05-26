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
        // -------------------------------------------------------------------------
        // 1. Reference secrets from Secrets Manager (no new secret created here)
        // -------------------------------------------------------------------------
        const appSecrets = secretsmanager.Secret.fromSecretNameV2(this, 'AppSecrets', `SyntheticSupabaseApp/${environment}/secrets`);
        // -------------------------------------------------------------------------
        // 2. Lambda execution role with basic execution + Secrets Manager read
        // -------------------------------------------------------------------------
        const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
            assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
            managedPolicies: [
                iam.ManagedPolicy.fromAwsManagedPolicyName('service-role/AWSLambdaBasicExecutionRole'),
            ],
        });
        // Grant Secrets Manager read access
        appSecrets.grantRead(lambdaRole);
        // -------------------------------------------------------------------------
        // 3. Log retention: 10 years for prod, 1 week for non-prod
        // -------------------------------------------------------------------------
        const logRetention = environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK;
        // -------------------------------------------------------------------------
        // 4. API Gateway RestApi with stage "api", CloudWatch logging, throttling
        //    No CORS config needed — CloudFront proxies /api/* to avoid cross-origin issues
        // -------------------------------------------------------------------------
        const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayAccessLogs', {
            retention: logRetention,
            removalPolicy: cdk.RemovalPolicy.DESTROY,
        });
        this.api = new apigateway.RestApi(this, 'AppApi', {
            restApiName: `SyntheticSupabaseApp-${environment}`,
            deployOptions: {
                stageName: 'api',
                accessLogDestination: new apigateway.LogGroupLogDestination(apiLogGroup),
                accessLogFormat: apigateway.AccessLogFormat.jsonWithStandardFields(),
                loggingLevel: apigateway.MethodLoggingLevel.INFO,
                dataTraceEnabled: false,
                throttlingRateLimit: 100,
                throttlingBurstLimit: 200,
            },
            // No defaultCorsPreflightOptions — CloudFront handles routing
        });
        this.apiGatewayDomain = `${this.api.restApiId}.execute-api.${this.region}.amazonaws.com`;
        // -------------------------------------------------------------------------
        // 5. Auto-discover functions from the lambda/ directory
        //    projectRoot is the repo root (one level above infra/)
        // -------------------------------------------------------------------------
        // __dirname = <repo>/infra/lib/stacks  →  projectRoot = <repo>
        const projectRoot = path.join(__dirname, '..', '..', '..');
        const lambdaRootDir = path.join(projectRoot, 'lambda');
        const functionDirs = fs
            .readdirSync(lambdaRootDir, { withFileTypes: true })
            .filter((entry) => entry.isDirectory())
            .map((entry) => entry.name);
        // -------------------------------------------------------------------------
        // 6. Create a NodejsFunction + API Gateway resource for each discovered fn
        // -------------------------------------------------------------------------
        for (const fnDir of functionDirs) {
            // Convert kebab-case dir name to PascalCase logical ID, e.g. "hello-world" → "HelloWorld"
            const logicalId = fnDir
                .split('-')
                .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
                .join('');
            const entryFile = path.join(lambdaRootDir, fnDir, 'index.ts');
            // Dedicated CloudWatch log group per function (replaces deprecated logRetention prop)
            const fnLogGroup = new logs.LogGroup(this, `${logicalId}LogGroup`, {
                logGroupName: `/aws/lambda/SyntheticSupabaseApp-${environment}-${fnDir}`,
                retention: logRetention,
                removalPolicy: cdk.RemovalPolicy.DESTROY,
            });
            const fn = new aws_lambda_nodejs_1.NodejsFunction(this, `${logicalId}Function`, {
                runtime: lambda.Runtime.NODEJS_LATEST,
                handler: 'handler',
                entry: entryFile,
                // projectRoot must contain both the entry file and the lock file
                projectRoot,
                depsLockFilePath: path.join(projectRoot, 'package-lock.json'),
                timeout: cdk.Duration.seconds(30),
                memorySize: 512,
                role: lambdaRole,
                logGroup: fnLogGroup,
                environment: {
                    SECRETS_ARN: appSecrets.secretArn,
                    ENVIRONMENT: environment,
                    API_GATEWAY_URL: `https://${this.apiGatewayDomain}/api`,
                },
                bundling: {
                    minify: true,
                    sourceMap: true,
                    target: 'es2022',
                    // externalModules are excluded from the bundle (available in the Lambda runtime)
                    externalModules: ['@aws-sdk/*'],
                },
            });
            // Create /fnDir resource under the API root and attach POST + GET methods
            const resource = this.api.root.addResource(fnDir);
            resource.addMethod('POST', new apigateway.LambdaIntegration(fn));
            resource.addMethod('GET', new apigateway.LambdaIntegration(fn));
        }
    }
}
exports.LambdaStack = LambdaStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoibGFtYmRhLXN0YWNrLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXMiOlsibGFtYmRhLXN0YWNrLnRzIl0sIm5hbWVzIjpbXSwibWFwcGluZ3MiOiI7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztBQUFBLGlEQUFtQztBQUNuQywrREFBaUQ7QUFDakQscUVBQStEO0FBQy9ELHVFQUF5RDtBQUN6RCwrRUFBaUU7QUFDakUseURBQTJDO0FBQzNDLDJEQUE2QztBQUU3Qyx1Q0FBeUI7QUFDekIsMkNBQTZCO0FBTTdCLE1BQWEsV0FBWSxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQ3hCLEdBQUcsQ0FBcUI7SUFDeEIsZ0JBQWdCLENBQVM7SUFFekMsWUFBWSxLQUFnQixFQUFFLEVBQVUsRUFBRSxLQUF1QjtRQUMvRCxLQUFLLENBQUMsS0FBSyxFQUFFLEVBQUUsRUFBRSxLQUFLLENBQUMsQ0FBQztRQUV4QixNQUFNLEVBQUUsV0FBVyxFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRTlCLDRFQUE0RTtRQUM1RSx5RUFBeUU7UUFDekUsNEVBQTRFO1FBQzVFLE1BQU0sVUFBVSxHQUFHLGNBQWMsQ0FBQyxNQUFNLENBQUMsZ0JBQWdCLENBQ3ZELElBQUksRUFDSixZQUFZLEVBQ1osd0JBQXdCLFdBQVcsVUFBVSxDQUM5QyxDQUFDO1FBRUYsNEVBQTRFO1FBQzVFLHVFQUF1RTtRQUN2RSw0RUFBNEU7UUFDNUUsTUFBTSxVQUFVLEdBQUcsSUFBSSxHQUFHLENBQUMsSUFBSSxDQUFDLElBQUksRUFBRSxxQkFBcUIsRUFBRTtZQUMzRCxTQUFTLEVBQUUsSUFBSSxHQUFHLENBQUMsZ0JBQWdCLENBQUMsc0JBQXNCLENBQUM7WUFDM0QsZUFBZSxFQUFFO2dCQUNmLEdBQUcsQ0FBQyxhQUFhLENBQUMsd0JBQXdCLENBQ3hDLDBDQUEwQyxDQUMzQzthQUNGO1NBQ0YsQ0FBQyxDQUFDO1FBRUgsb0NBQW9DO1FBQ3BDLFVBQVUsQ0FBQyxTQUFTLENBQUMsVUFBVSxDQUFDLENBQUM7UUFFakMsNEVBQTRFO1FBQzVFLDJEQUEyRDtRQUMzRCw0RUFBNEU7UUFDNUUsTUFBTSxZQUFZLEdBQ2hCLFdBQVcsS0FBSyxNQUFNO1lBQ3BCLENBQUMsQ0FBQyxJQUFJLENBQUMsYUFBYSxDQUFDLFNBQVM7WUFDOUIsQ0FBQyxDQUFDLElBQUksQ0FBQyxhQUFhLENBQUMsUUFBUSxDQUFDO1FBRWxDLDRFQUE0RTtRQUM1RSwwRUFBMEU7UUFDMUUsb0ZBQW9GO1FBQ3BGLDRFQUE0RTtRQUM1RSxNQUFNLFdBQVcsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLHNCQUFzQixFQUFFO1lBQ2xFLFNBQVMsRUFBRSxZQUFZO1lBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87U0FDekMsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLEdBQUcsR0FBRyxJQUFJLFVBQVUsQ0FBQyxPQUFPLENBQUMsSUFBSSxFQUFFLFFBQVEsRUFBRTtZQUNoRCxXQUFXLEVBQUUsd0JBQXdCLFdBQVcsRUFBRTtZQUNsRCxhQUFhLEVBQUU7Z0JBQ2IsU0FBUyxFQUFFLEtBQUs7Z0JBQ2hCLG9CQUFvQixFQUFFLElBQUksVUFBVSxDQUFDLHNCQUFzQixDQUN6RCxXQUFXLENBQ1o7Z0JBQ0QsZUFBZSxFQUFFLFVBQVUsQ0FBQyxlQUFlLENBQUMsc0JBQXNCLEVBQUU7Z0JBQ3BFLFlBQVksRUFBRSxVQUFVLENBQUMsa0JBQWtCLENBQUMsSUFBSTtnQkFDaEQsZ0JBQWdCLEVBQUUsS0FBSztnQkFDdkIsbUJBQW1CLEVBQUUsR0FBRztnQkFDeEIsb0JBQW9CLEVBQUUsR0FBRzthQUMxQjtZQUNELDhEQUE4RDtTQUMvRCxDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsZ0JBQWdCLEdBQUcsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLFNBQVMsZ0JBQWdCLElBQUksQ0FBQyxNQUFNLGdCQUFnQixDQUFDO1FBRXpGLDRFQUE0RTtRQUM1RSx3REFBd0Q7UUFDeEQsMkRBQTJEO1FBQzNELDRFQUE0RTtRQUM1RSwrREFBK0Q7UUFDL0QsTUFBTSxXQUFXLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLENBQUMsQ0FBQztRQUMzRCxNQUFNLGFBQWEsR0FBRyxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxRQUFRLENBQUMsQ0FBQztRQUV2RCxNQUFNLFlBQVksR0FBRyxFQUFFO2FBQ3BCLFdBQVcsQ0FBQyxhQUFhLEVBQUUsRUFBRSxhQUFhLEVBQUUsSUFBSSxFQUFFLENBQUM7YUFDbkQsTUFBTSxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsV0FBVyxFQUFFLENBQUM7YUFDdEMsR0FBRyxDQUFDLENBQUMsS0FBSyxFQUFFLEVBQUUsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFDLENBQUM7UUFFOUIsNEVBQTRFO1FBQzVFLDJFQUEyRTtRQUMzRSw0RUFBNEU7UUFDNUUsS0FBSyxNQUFNLEtBQUssSUFBSSxZQUFZLEVBQUUsQ0FBQztZQUNqQywwRkFBMEY7WUFDMUYsTUFBTSxTQUFTLEdBQUcsS0FBSztpQkFDcEIsS0FBSyxDQUFDLEdBQUcsQ0FBQztpQkFDVixHQUFHLENBQUMsQ0FBQyxJQUFJLEVBQUUsRUFBRSxDQUFDLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQyxDQUFDLENBQUMsV0FBVyxFQUFFLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQyxDQUFDLENBQUMsQ0FBQztpQkFDM0QsSUFBSSxDQUFDLEVBQUUsQ0FBQyxDQUFDO1lBRVosTUFBTSxTQUFTLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQyxhQUFhLEVBQUUsS0FBSyxFQUFFLFVBQVUsQ0FBQyxDQUFDO1lBRTlELHNGQUFzRjtZQUN0RixNQUFNLFVBQVUsR0FBRyxJQUFJLElBQUksQ0FBQyxRQUFRLENBQUMsSUFBSSxFQUFFLEdBQUcsU0FBUyxVQUFVLEVBQUU7Z0JBQ2pFLFlBQVksRUFBRSxvQ0FBb0MsV0FBVyxJQUFJLEtBQUssRUFBRTtnQkFDeEUsU0FBUyxFQUFFLFlBQVk7Z0JBQ3ZCLGFBQWEsRUFBRSxHQUFHLENBQUMsYUFBYSxDQUFDLE9BQU87YUFDekMsQ0FBQyxDQUFDO1lBRUgsTUFBTSxFQUFFLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxHQUFHLFNBQVMsVUFBVSxFQUFFO2dCQUMxRCxPQUFPLEVBQUUsTUFBTSxDQUFDLE9BQU8sQ0FBQyxhQUFhO2dCQUNyQyxPQUFPLEVBQUUsU0FBUztnQkFDbEIsS0FBSyxFQUFFLFNBQVM7Z0JBQ2hCLGlFQUFpRTtnQkFDakUsV0FBVztnQkFDWCxnQkFBZ0IsRUFBRSxJQUFJLENBQUMsSUFBSSxDQUFDLFdBQVcsRUFBRSxtQkFBbUIsQ0FBQztnQkFDN0QsT0FBTyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLEVBQUUsQ0FBQztnQkFDakMsVUFBVSxFQUFFLEdBQUc7Z0JBQ2YsSUFBSSxFQUFFLFVBQVU7Z0JBQ2hCLFFBQVEsRUFBRSxVQUFVO2dCQUNwQixXQUFXLEVBQUU7b0JBQ1gsV0FBVyxFQUFFLFVBQVUsQ0FBQyxTQUFTO29CQUNqQyxXQUFXLEVBQUUsV0FBVztvQkFDeEIsZUFBZSxFQUFFLFdBQVcsSUFBSSxDQUFDLGdCQUFnQixNQUFNO2lCQUN4RDtnQkFDRCxRQUFRLEVBQUU7b0JBQ1IsTUFBTSxFQUFFLElBQUk7b0JBQ1osU0FBUyxFQUFFLElBQUk7b0JBQ2YsTUFBTSxFQUFFLFFBQVE7b0JBQ2hCLGlGQUFpRjtvQkFDakYsZUFBZSxFQUFFLENBQUMsWUFBWSxDQUFDO2lCQUNoQzthQUNGLENBQUMsQ0FBQztZQUVILDBFQUEwRTtZQUMxRSxNQUFNLFFBQVEsR0FBRyxJQUFJLENBQUMsR0FBRyxDQUFDLElBQUksQ0FBQyxXQUFXLENBQUMsS0FBSyxDQUFDLENBQUM7WUFDbEQsUUFBUSxDQUFDLFNBQVMsQ0FBQyxNQUFNLEVBQUUsSUFBSSxVQUFVLENBQUMsaUJBQWlCLENBQUMsRUFBRSxDQUFDLENBQUMsQ0FBQztZQUNqRSxRQUFRLENBQUMsU0FBUyxDQUFDLEtBQUssRUFBRSxJQUFJLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxFQUFFLENBQUMsQ0FBQyxDQUFDO1FBQ2xFLENBQUM7SUFDSCxDQUFDO0NBQ0Y7QUFuSUQsa0NBbUlDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGxhbWJkYSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbGFtYmRhJztcbmltcG9ydCB7IE5vZGVqc0Z1bmN0aW9uIH0gZnJvbSAnYXdzLWNkay1saWIvYXdzLWxhbWJkYS1ub2RlanMnO1xuaW1wb3J0ICogYXMgYXBpZ2F0ZXdheSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtYXBpZ2F0ZXdheSc7XG5pbXBvcnQgKiBhcyBzZWNyZXRzbWFuYWdlciBmcm9tICdhd3MtY2RrLWxpYi9hd3Mtc2VjcmV0c21hbmFnZXInO1xuaW1wb3J0ICogYXMgaWFtIGZyb20gJ2F3cy1jZGstbGliL2F3cy1pYW0nO1xuaW1wb3J0ICogYXMgbG9ncyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtbG9ncyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcbmltcG9ydCAqIGFzIGZzIGZyb20gJ2ZzJztcbmltcG9ydCAqIGFzIHBhdGggZnJvbSAncGF0aCc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgTGFtYmRhU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIExhbWJkYVN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGFwaTogYXBpZ2F0ZXdheS5SZXN0QXBpO1xuICBwdWJsaWMgcmVhZG9ubHkgYXBpR2F0ZXdheURvbWFpbjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBMYW1iZGFTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50IH0gPSBwcm9wcztcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAxLiBSZWZlcmVuY2Ugc2VjcmV0cyBmcm9tIFNlY3JldHMgTWFuYWdlciAobm8gbmV3IHNlY3JldCBjcmVhdGVkIGhlcmUpXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGFwcFNlY3JldHMgPSBzZWNyZXRzbWFuYWdlci5TZWNyZXQuZnJvbVNlY3JldE5hbWVWMihcbiAgICAgIHRoaXMsXG4gICAgICAnQXBwU2VjcmV0cycsXG4gICAgICBgU3ludGhldGljU3VwYWJhc2VBcHAvJHtlbnZpcm9ubWVudH0vc2VjcmV0c2BcbiAgICApO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDIuIExhbWJkYSBleGVjdXRpb24gcm9sZSB3aXRoIGJhc2ljIGV4ZWN1dGlvbiArIFNlY3JldHMgTWFuYWdlciByZWFkXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGxhbWJkYVJvbGUgPSBuZXcgaWFtLlJvbGUodGhpcywgJ0xhbWJkYUV4ZWN1dGlvblJvbGUnLCB7XG4gICAgICBhc3N1bWVkQnk6IG5ldyBpYW0uU2VydmljZVByaW5jaXBhbCgnbGFtYmRhLmFtYXpvbmF3cy5jb20nKSxcbiAgICAgIG1hbmFnZWRQb2xpY2llczogW1xuICAgICAgICBpYW0uTWFuYWdlZFBvbGljeS5mcm9tQXdzTWFuYWdlZFBvbGljeU5hbWUoXG4gICAgICAgICAgJ3NlcnZpY2Utcm9sZS9BV1NMYW1iZGFCYXNpY0V4ZWN1dGlvblJvbGUnXG4gICAgICAgICksXG4gICAgICBdLFxuICAgIH0pO1xuXG4gICAgLy8gR3JhbnQgU2VjcmV0cyBNYW5hZ2VyIHJlYWQgYWNjZXNzXG4gICAgYXBwU2VjcmV0cy5ncmFudFJlYWQobGFtYmRhUm9sZSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMy4gTG9nIHJldGVudGlvbjogMTAgeWVhcnMgZm9yIHByb2QsIDEgd2VlayBmb3Igbm9uLXByb2RcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgbG9nUmV0ZW50aW9uID1cbiAgICAgIGVudmlyb25tZW50ID09PSAncHJvZCdcbiAgICAgICAgPyBsb2dzLlJldGVudGlvbkRheXMuVEVOX1lFQVJTXG4gICAgICAgIDogbG9ncy5SZXRlbnRpb25EYXlzLk9ORV9XRUVLO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDQuIEFQSSBHYXRld2F5IFJlc3RBcGkgd2l0aCBzdGFnZSBcImFwaVwiLCBDbG91ZFdhdGNoIGxvZ2dpbmcsIHRocm90dGxpbmdcbiAgICAvLyAgICBObyBDT1JTIGNvbmZpZyBuZWVkZWQg4oCUIENsb3VkRnJvbnQgcHJveGllcyAvYXBpLyogdG8gYXZvaWQgY3Jvc3Mtb3JpZ2luIGlzc3Vlc1xuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBhcGlMb2dHcm91cCA9IG5ldyBsb2dzLkxvZ0dyb3VwKHRoaXMsICdBcGlHYXRld2F5QWNjZXNzTG9ncycsIHtcbiAgICAgIHJldGVudGlvbjogbG9nUmV0ZW50aW9uLFxuICAgICAgcmVtb3ZhbFBvbGljeTogY2RrLlJlbW92YWxQb2xpY3kuREVTVFJPWSxcbiAgICB9KTtcblxuICAgIHRoaXMuYXBpID0gbmV3IGFwaWdhdGV3YXkuUmVzdEFwaSh0aGlzLCAnQXBwQXBpJywge1xuICAgICAgcmVzdEFwaU5hbWU6IGBTeW50aGV0aWNTdXBhYmFzZUFwcC0ke2Vudmlyb25tZW50fWAsXG4gICAgICBkZXBsb3lPcHRpb25zOiB7XG4gICAgICAgIHN0YWdlTmFtZTogJ2FwaScsXG4gICAgICAgIGFjY2Vzc0xvZ0Rlc3RpbmF0aW9uOiBuZXcgYXBpZ2F0ZXdheS5Mb2dHcm91cExvZ0Rlc3RpbmF0aW9uKFxuICAgICAgICAgIGFwaUxvZ0dyb3VwXG4gICAgICAgICksXG4gICAgICAgIGFjY2Vzc0xvZ0Zvcm1hdDogYXBpZ2F0ZXdheS5BY2Nlc3NMb2dGb3JtYXQuanNvbldpdGhTdGFuZGFyZEZpZWxkcygpLFxuICAgICAgICBsb2dnaW5nTGV2ZWw6IGFwaWdhdGV3YXkuTWV0aG9kTG9nZ2luZ0xldmVsLklORk8sXG4gICAgICAgIGRhdGFUcmFjZUVuYWJsZWQ6IGZhbHNlLFxuICAgICAgICB0aHJvdHRsaW5nUmF0ZUxpbWl0OiAxMDAsXG4gICAgICAgIHRocm90dGxpbmdCdXJzdExpbWl0OiAyMDAsXG4gICAgICB9LFxuICAgICAgLy8gTm8gZGVmYXVsdENvcnNQcmVmbGlnaHRPcHRpb25zIOKAlCBDbG91ZEZyb250IGhhbmRsZXMgcm91dGluZ1xuICAgIH0pO1xuXG4gICAgdGhpcy5hcGlHYXRld2F5RG9tYWluID0gYCR7dGhpcy5hcGkucmVzdEFwaUlkfS5leGVjdXRlLWFwaS4ke3RoaXMucmVnaW9ufS5hbWF6b25hd3MuY29tYDtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyA1LiBBdXRvLWRpc2NvdmVyIGZ1bmN0aW9ucyBmcm9tIHRoZSBsYW1iZGEvIGRpcmVjdG9yeVxuICAgIC8vICAgIHByb2plY3RSb290IGlzIHRoZSByZXBvIHJvb3QgKG9uZSBsZXZlbCBhYm92ZSBpbmZyYS8pXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIF9fZGlybmFtZSA9IDxyZXBvPi9pbmZyYS9saWIvc3RhY2tzICDihpIgIHByb2plY3RSb290ID0gPHJlcG8+XG4gICAgY29uc3QgcHJvamVjdFJvb3QgPSBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnLi4nKTtcbiAgICBjb25zdCBsYW1iZGFSb290RGlyID0gcGF0aC5qb2luKHByb2plY3RSb290LCAnbGFtYmRhJyk7XG5cbiAgICBjb25zdCBmdW5jdGlvbkRpcnMgPSBmc1xuICAgICAgLnJlYWRkaXJTeW5jKGxhbWJkYVJvb3REaXIsIHsgd2l0aEZpbGVUeXBlczogdHJ1ZSB9KVxuICAgICAgLmZpbHRlcigoZW50cnkpID0+IGVudHJ5LmlzRGlyZWN0b3J5KCkpXG4gICAgICAubWFwKChlbnRyeSkgPT4gZW50cnkubmFtZSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNi4gQ3JlYXRlIGEgTm9kZWpzRnVuY3Rpb24gKyBBUEkgR2F0ZXdheSByZXNvdXJjZSBmb3IgZWFjaCBkaXNjb3ZlcmVkIGZuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGZvciAoY29uc3QgZm5EaXIgb2YgZnVuY3Rpb25EaXJzKSB7XG4gICAgICAvLyBDb252ZXJ0IGtlYmFiLWNhc2UgZGlyIG5hbWUgdG8gUGFzY2FsQ2FzZSBsb2dpY2FsIElELCBlLmcuIFwiaGVsbG8td29ybGRcIiDihpIgXCJIZWxsb1dvcmxkXCJcbiAgICAgIGNvbnN0IGxvZ2ljYWxJZCA9IGZuRGlyXG4gICAgICAgIC5zcGxpdCgnLScpXG4gICAgICAgIC5tYXAoKHBhcnQpID0+IHBhcnQuY2hhckF0KDApLnRvVXBwZXJDYXNlKCkgKyBwYXJ0LnNsaWNlKDEpKVxuICAgICAgICAuam9pbignJyk7XG5cbiAgICAgIGNvbnN0IGVudHJ5RmlsZSA9IHBhdGguam9pbihsYW1iZGFSb290RGlyLCBmbkRpciwgJ2luZGV4LnRzJyk7XG5cbiAgICAgIC8vIERlZGljYXRlZCBDbG91ZFdhdGNoIGxvZyBncm91cCBwZXIgZnVuY3Rpb24gKHJlcGxhY2VzIGRlcHJlY2F0ZWQgbG9nUmV0ZW50aW9uIHByb3ApXG4gICAgICBjb25zdCBmbkxvZ0dyb3VwID0gbmV3IGxvZ3MuTG9nR3JvdXAodGhpcywgYCR7bG9naWNhbElkfUxvZ0dyb3VwYCwge1xuICAgICAgICBsb2dHcm91cE5hbWU6IGAvYXdzL2xhbWJkYS9TeW50aGV0aWNTdXBhYmFzZUFwcC0ke2Vudmlyb25tZW50fS0ke2ZuRGlyfWAsXG4gICAgICAgIHJldGVudGlvbjogbG9nUmV0ZW50aW9uLFxuICAgICAgICByZW1vdmFsUG9saWN5OiBjZGsuUmVtb3ZhbFBvbGljeS5ERVNUUk9ZLFxuICAgICAgfSk7XG5cbiAgICAgIGNvbnN0IGZuID0gbmV3IE5vZGVqc0Z1bmN0aW9uKHRoaXMsIGAke2xvZ2ljYWxJZH1GdW5jdGlvbmAsIHtcbiAgICAgICAgcnVudGltZTogbGFtYmRhLlJ1bnRpbWUuTk9ERUpTX0xBVEVTVCxcbiAgICAgICAgaGFuZGxlcjogJ2hhbmRsZXInLFxuICAgICAgICBlbnRyeTogZW50cnlGaWxlLFxuICAgICAgICAvLyBwcm9qZWN0Um9vdCBtdXN0IGNvbnRhaW4gYm90aCB0aGUgZW50cnkgZmlsZSBhbmQgdGhlIGxvY2sgZmlsZVxuICAgICAgICBwcm9qZWN0Um9vdCxcbiAgICAgICAgZGVwc0xvY2tGaWxlUGF0aDogcGF0aC5qb2luKHByb2plY3RSb290LCAncGFja2FnZS1sb2NrLmpzb24nKSxcbiAgICAgICAgdGltZW91dDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMzApLFxuICAgICAgICBtZW1vcnlTaXplOiA1MTIsXG4gICAgICAgIHJvbGU6IGxhbWJkYVJvbGUsXG4gICAgICAgIGxvZ0dyb3VwOiBmbkxvZ0dyb3VwLFxuICAgICAgICBlbnZpcm9ubWVudDoge1xuICAgICAgICAgIFNFQ1JFVFNfQVJOOiBhcHBTZWNyZXRzLnNlY3JldEFybixcbiAgICAgICAgICBFTlZJUk9OTUVOVDogZW52aXJvbm1lbnQsXG4gICAgICAgICAgQVBJX0dBVEVXQVlfVVJMOiBgaHR0cHM6Ly8ke3RoaXMuYXBpR2F0ZXdheURvbWFpbn0vYXBpYCxcbiAgICAgICAgfSxcbiAgICAgICAgYnVuZGxpbmc6IHtcbiAgICAgICAgICBtaW5pZnk6IHRydWUsXG4gICAgICAgICAgc291cmNlTWFwOiB0cnVlLFxuICAgICAgICAgIHRhcmdldDogJ2VzMjAyMicsXG4gICAgICAgICAgLy8gZXh0ZXJuYWxNb2R1bGVzIGFyZSBleGNsdWRlZCBmcm9tIHRoZSBidW5kbGUgKGF2YWlsYWJsZSBpbiB0aGUgTGFtYmRhIHJ1bnRpbWUpXG4gICAgICAgICAgZXh0ZXJuYWxNb2R1bGVzOiBbJ0Bhd3Mtc2RrLyonXSxcbiAgICAgICAgfSxcbiAgICAgIH0pO1xuXG4gICAgICAvLyBDcmVhdGUgL2ZuRGlyIHJlc291cmNlIHVuZGVyIHRoZSBBUEkgcm9vdCBhbmQgYXR0YWNoIFBPU1QgKyBHRVQgbWV0aG9kc1xuICAgICAgY29uc3QgcmVzb3VyY2UgPSB0aGlzLmFwaS5yb290LmFkZFJlc291cmNlKGZuRGlyKTtcbiAgICAgIHJlc291cmNlLmFkZE1ldGhvZCgnUE9TVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGZuKSk7XG4gICAgICByZXNvdXJjZS5hZGRNZXRob2QoJ0dFVCcsIG5ldyBhcGlnYXRld2F5LkxhbWJkYUludGVncmF0aW9uKGZuKSk7XG4gICAgfVxuICB9XG59XG4iXX0=