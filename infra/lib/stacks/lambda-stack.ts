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

    // __dirname = <repo>/infra/lib/stacks  →  repo root is three levels up
    const repoRoot = path.resolve(__dirname, '..', '..', '..');

    // 1. Reference secrets from Secrets Manager
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

    // Grant Secrets Manager read access
    appSecrets.grantRead(lambdaRole);

    // 3. Create CloudWatch log group for API Gateway
    const apiLogGroup = new logs.LogGroup(this, 'ApiGatewayLogGroup', {
      logGroupName: `/aws/apigateway/SyntheticSupabaseApp-${environment}`,
      retention:
        environment === 'prod'
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
        retention:
          environment === 'prod'
            ? logs.RetentionDays.TEN_YEARS
            : logs.RetentionDays.ONE_WEEK,
        removalPolicy: cdk.RemovalPolicy.DESTROY,
      });

      const fn = new NodejsFunction(this, `${fnId}Function`, {
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
      resource.addMethod(
        'POST',
        new apigateway.LambdaIntegration(fn, { proxy: true })
      );
      resource.addMethod(
        'GET',
        new apigateway.LambdaIntegration(fn, { proxy: true })
      );
    }
  }
}
