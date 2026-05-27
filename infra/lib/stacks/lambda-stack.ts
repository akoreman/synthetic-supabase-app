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

    // 1. Reference the secret in Secrets Manager
    // Secret name pattern: <AppName>/<environment>/secrets
    const appSecrets = secretsmanager.Secret.fromSecretNameV2(
      this,
      'AppSecrets',
      `synthetic-supabase-app/${environment}/secrets`,
    );

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

      const fn = new NodejsFunction(this, `${logicalId}Function`, {
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
