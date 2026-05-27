import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { CloudFrontToS3 } from '@aws-solutions-constructs/aws-cloudfront-s3';
import { Construct } from 'constructs';
import * as path from 'path';

export interface FrontendStackProps extends cdk.StackProps {
  environment: string;
  buildOutputPath: string; // e.g. "../dist"
  apiGatewayDomain: string;
}

export class FrontendStack extends cdk.Stack {
  public readonly distributionDomainName: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { environment, buildOutputPath, apiGatewayDomain } = props;

    // ── 1. CloudFrontToS3 solution construct ────────────────────────────────
    // Creates the S3 bucket (private, OAC-protected) and a CloudFront distribution.
    const cloudFrontToS3 = new CloudFrontToS3(this, 'CloudFrontToS3', {
      insertHttpSecurityHeaders: false, // we manage CSP ourselves via CF Function
      cloudFrontDistributionProps: {
        defaultRootObject: 'index.html',
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,

        // ── 2. SPA error responses (403/404 → /index.html) ──────────────────
        errorResponses: [
          {
            httpStatus: 403,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
          {
            httpStatus: 404,
            responseHttpStatus: 200,
            responsePagePath: '/index.html',
            ttl: cdk.Duration.seconds(0),
          },
        ],
      },
    });

    const distribution = cloudFrontToS3.cloudFrontWebDistribution;

    // ── 3. CSP CloudFront Function ───────────────────────────────────────────
    // Permissive policy that allows third-party CDNs/APIs (Supabase, etc.)
    const cspFunction = new cloudfront.Function(this, 'CspFunction', {
      functionName: `csp-headers-${environment}`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['content-security-policy'] = {
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https: wss:",
      "media-src 'self' https:",
      "frame-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self' https:"
    ].join('; ')
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'SAMEORIGIN' };
  headers['x-xss-protection'] = { value: '1; mode=block' };
  headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
  return response;
}
      `.trim()),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
      comment: 'Adds permissive CSP and security headers to all responses',
    });

    // Attach the CSP function to the default (*) behavior as a viewer-response handler.
    // CloudFrontToS3 exposes the CfnDistribution so we patch it via escape hatch.
    const cfnDistribution = distribution.node.defaultChild as cloudfront.CfnDistribution;
    cfnDistribution.addPropertyOverride(
      'DistributionConfig.DefaultCacheBehavior.FunctionAssociations',
      [
        {
          EventType: 'viewer-response',
          FunctionARN: cspFunction.functionArn,
        },
      ],
    );

    // ── 4. /api/* behavior → API Gateway origin ──────────────────────────────
    const apiOrigin = new origins.HttpOrigin(apiGatewayDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: '',
    });

    distribution.addBehavior('/api/*', apiOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // ── 5. BucketDeployment ──────────────────────────────────────────────────
    // Resolve the build output path relative to the infra directory root
    const resolvedBuildPath = path.isAbsolute(buildOutputPath)
      ? buildOutputPath
      : path.join(__dirname, '..', '..', '..', buildOutputPath.replace(/^\.\.\//, ''));

    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(resolvedBuildPath)],
      destinationBucket: cloudFrontToS3.s3BucketInterface as cdk.aws_s3.IBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 256,
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // ── 6. Outputs ───────────────────────────────────────────────────────────
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
    });
  }
}
