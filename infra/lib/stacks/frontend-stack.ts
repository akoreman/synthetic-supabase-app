import * as cdk from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import { CloudFrontToS3 } from '@aws-solutions-constructs/aws-cloudfront-s3';
import { Construct } from 'constructs';

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

    // ---------------------------------------------------------------------------
    // 3. CSP CloudFront Function — permissive policy for third-party CDNs/APIs
    // ---------------------------------------------------------------------------
    const cspFunction = new cloudfront.Function(this, 'CspFunction', {
      functionName: `App-${environment}-csp`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['content-security-policy'] = {
    value: "default-src 'self'; " +
           "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; " +
           "style-src 'self' 'unsafe-inline' https:; " +
           "img-src 'self' data: https:; " +
           "font-src 'self' data: https:; " +
           "connect-src 'self' https:; " +
           "frame-src 'self' https:;"
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'SAMEORIGIN' };
  headers['x-xss-protection'] = { value: '1; mode=block' };
  return response;
}
      `.trim()),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // ---------------------------------------------------------------------------
    // 1. CloudFrontToS3 solution construct — S3 bucket + CloudFront with OAC
    // ---------------------------------------------------------------------------
    const cloudFrontToS3 = new CloudFrontToS3(this, 'CloudFrontToS3', {
      insertHttpSecurityHeaders: false, // we handle headers via our own CSP function
      cloudFrontDistributionProps: {
        defaultBehavior: {
          // CSP function runs on viewer-response
          functionAssociations: [
            {
              function: cspFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
        },
        // 2. SPA error responses: 403/404 → /index.html with 200 status
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
        // 6. Price class, HTTP versions, TLS minimum
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        comment: `App-${environment} frontend distribution`,
      },
    });

    const distribution = cloudFrontToS3.cloudFrontWebDistribution;

    // ---------------------------------------------------------------------------
    // 4. /api/* behavior — proxy to API Gateway origin (HTTPS only, no caching)
    // ---------------------------------------------------------------------------
    const apiOrigin = new origins.HttpOrigin(apiGatewayDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: '',
    });

    distribution.addBehavior('/api/*', apiOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // ---------------------------------------------------------------------------
    // 5. BucketDeployment — sync build output to S3 + CloudFront invalidation
    // ---------------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(buildOutputPath)],
      destinationBucket: cloudFrontToS3.s3BucketInterface as cdk.aws_s3.IBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // Outputs
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
      exportName: `App-${environment}-CloudFrontURL`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront distribution ID',
      exportName: `App-${environment}-CloudFrontDistributionId`,
    });
  }
}
