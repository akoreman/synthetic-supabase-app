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
    const appName = 'synthetic-supabase-app';

    // The monorepo root is one level above the infra/ directory.
    // NodejsFunction requires entry to be under projectRoot, so we set
    // projectRoot to the repo root so it can reach lambda/ sibling directory.
    const repoRoot = path.join(__dirname, '..', '..', '..');

    // -----------------------------------------------------------------------
    // 1. Reference the Secrets Manager secret (created outside this stack)
    // -----------------------------------------------------------------------
    const appSecret = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `${appName}/${environment}/secrets`
    );

    // -----------------------------------------------------------------------
    // 2. Lambda execution role
    //    - AWSLambdaBasicExecutionRole (CloudWatch Logs)
    //    - Secrets Manager read access for the app secret
    // -----------------------------------------------------------------------
    const lambdaRole = new iam.Role(this, 'LambdaExecutionRole', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      managedPolicies: [
        iam.ManagedPolicy.fromAwsManagedPolicyName(
          'service-role/AWSLambdaBasicExecutionRole'
        ),
      ],
    });

    // Grant read access to the secret
    appSecret.grantRead(lambdaRole);

    // -----------------------------------------------------------------------
    // 3. Log retention: 10 years for prod, 1 week for non-prod
    // -----------------------------------------------------------------------
    const logRetention =
      environment === 'prod'
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

      const fn = new NodejsFunction(this, `${logicalId}Function`, {
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
