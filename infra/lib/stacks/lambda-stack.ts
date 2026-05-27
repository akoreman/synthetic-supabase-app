import * as cdk from 'aws-cdk-lib';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import { Construct } from 'constructs';
import * as fs from 'fs';
import * as path from 'path';

export interface LambdaStackProps extends cdk.StackProps {
  environment: string;
}

export class LambdaStack extends cdk.Stack {
  public readonly api: apigateway.RestApi;
  public readonly apiGatewayDomain: string;

  constructor(scope: Construct, id: string, props: LambdaStackProps) {
    super(scope, id, props);

    const { environment } = props;

    // 1. Reference secrets from Secrets Manager (created externally / by SecretsStack)
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `synthetic-supabase-app/${environment}/secrets`,
    );

    // 2. Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole',
        ),
      ],
    });

    // Allow Lambda to read the secret
    appSecrets.grantRead(lambdaRole);

    // 3. No AI/Bedrock functions detected — skip Bedrock policy

    // 4. Log retention: 10 years for prod, 1 week for non-prod
    const logRetention =
      environment === 'prod'
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

      const fn = new NodejsFunction(this, `${logicalId}Function`, {
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
