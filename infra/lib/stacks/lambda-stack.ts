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

    // -------------------------------------------------------------------------
    // 1. Reference secrets from Secrets Manager (no new secret created here)
    // -------------------------------------------------------------------------
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `SyntheticSupabaseApp/${environment}/secrets`
    );

    // -------------------------------------------------------------------------
    // 2. Lambda execution role with basic execution + Secrets Manager read
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 3. Log retention: 10 years for prod, 1 week for non-prod
    // -------------------------------------------------------------------------
    const logRetention =
      environment === 'prod'
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
        accessLogDestination: new apigateway.LogGroupLogDestination(
          apiLogGroup
        ),
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

      const fn = new NodejsFunction(this, `${logicalId}Function`, {
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
