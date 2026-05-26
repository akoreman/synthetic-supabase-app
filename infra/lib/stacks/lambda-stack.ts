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
    const isProd = environment === 'prod';

    // Repo root is 3 levels up from infra/lib/stacks/
    const repoRoot = path.join(__dirname, '..', '..', '..');
    const lambdaBaseDir = path.join(repoRoot, 'lambda');

    // 1. Reference secrets from Secrets Manager
    // Path: SyntheticSupabaseApp/<environment>/secrets
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `SyntheticSupabaseApp/${environment}/secrets`
    );

    // 2. Create Lambda execution role with AWSLambdaBasicExecutionRole + Secrets Manager read
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
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
      if (!fs.existsSync(entryFile)) continue;

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

      const fn = new NodejsFunction(this, `${logicalId}Function`, {
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
