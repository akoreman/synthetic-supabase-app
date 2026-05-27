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

    // -----------------------------------------------------------------------
    // 1. CSP CloudFront Function (permissive policy for third-party CDNs/APIs)
    // -----------------------------------------------------------------------
    const cspFunction = new cloudfront.Function(this, 'CspFunction', {
      functionName: `csp-headers-${environment}`,
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
           "frame-src 'self' https:; " +
           "object-src 'none';"
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'SAMEORIGIN' };
  headers['x-xss-protection'] = { value: '1; mode=block' };
  return response;
}
      `),
      runtime: cloudfront.FunctionRuntime.JS_2_0,
    });

    // -----------------------------------------------------------------------
    // 2. CloudFrontToS3 solution construct — S3 bucket + CloudFront with OAC
    // -----------------------------------------------------------------------
    const cloudFrontToS3 = new CloudFrontToS3(this, 'CloudFrontToS3', {
      insertHttpSecurityHeaders: false, // We manage headers via our CSP Function
      cloudFrontDistributionProps: {
        defaultBehavior: {
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [
            {
              function: cspFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
        // SPA error responses — redirect 403/404 to /index.html for client-side routing
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
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion:
          cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        enableLogging: false,
      },
    });

    // -----------------------------------------------------------------------
    // 3. Add /api/* behavior — proxy to API Gateway origin
    //    - HTTPS only, caching disabled, all viewer headers forwarded
    // -----------------------------------------------------------------------
    const apiOrigin = new origins.HttpOrigin(apiGatewayDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: '',
    });

    cloudFrontToS3.cloudFrontWebDistribution.addBehavior('/api/*', apiOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    this.distributionDomainName =
      cloudFrontToS3.cloudFrontWebDistribution.distributionDomainName;

    // -----------------------------------------------------------------------
    // 4. BucketDeployment — sync build output to S3 + CloudFront invalidation
    // -----------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployWebsite', {
      sources: [s3deploy.Source.asset(buildOutputPath)],
      destinationBucket: cloudFrontToS3.s3BucketInterface as cdk.aws_s3.IBucket,
      distribution: cloudFrontToS3.cloudFrontWebDistribution,
      distributionPaths: ['/*'],
      prune: true,
    });

    // -----------------------------------------------------------------------
    // 5. Stack outputs
    // -----------------------------------------------------------------------
    new cdk.CfnOutput(this, 'DistributionDomainName', {
      value: this.distributionDomainName,
      description: 'CloudFront Distribution Domain Name',
      exportName: `${id}-DistributionDomainName`,
    });

    new cdk.CfnOutput(this, 'WebsiteUrl', {
      value: `https://${this.distributionDomainName}`,
      description: 'Website URL',
      exportName: `${id}-WebsiteUrl`,
    });
  }
}
