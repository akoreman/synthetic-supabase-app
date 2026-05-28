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

    // 1. Reference secrets from Secrets Manager
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `App/${environment}/secrets`
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

    // Grant Secrets Manager read access
    appSecrets.grantRead(lambdaRole);

    // 3. Log retention: 10 years for prod, 1 week for non-prod
    const logRetentionDays =
      environment === 'prod'
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
      const fn = new NodejsFunction(this, `${constructId}Function`, {
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
