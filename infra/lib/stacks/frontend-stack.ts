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
  public readonly distributionDomain: string;

  constructor(scope: Construct, id: string, props: FrontendStackProps) {
    super(scope, id, props);

    const { environment, buildOutputPath, apiGatewayDomain } = props;

    // ---------------------------------------------------------------
    // 1. CSP CloudFront Function (permissive for third-party CDNs/APIs)
    // ---------------------------------------------------------------
    const cspFunction = new cloudfront.Function(this, 'CspFunction', {
      functionName: `SyntheticSupabaseApp-CSP-${environment}`,
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['content-security-policy'] = {
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https:",
      "style-src 'self' 'unsafe-inline' https:",
      "img-src 'self' data: https:",
      "font-src 'self' data: https:",
      "connect-src 'self' https:",
      "frame-src 'self' https:",
      "object-src 'none'",
      "base-uri 'self'"
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
    });

    // ---------------------------------------------------------------
    // 2. CloudFrontToS3 solution construct — S3 bucket + CloudFront
    //    distribution with OAC already configured
    // ---------------------------------------------------------------
    const cloudfrontToS3 = new CloudFrontToS3(this, 'CloudFrontToS3', {
      insertHttpSecurityHeaders: false, // we add our own CSP function
      cloudFrontDistributionProps: {
        defaultBehavior: {
          // CSP function attached to the viewer-response of the default (S3) behavior
          functionAssociations: [
            {
              function: cspFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
          viewerProtocolPolicy:
            cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        },
        // SPA error responses: 403 / 404 → /index.html with 200
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
        // HTTP/2 + HTTP/3, cheapest price class
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        minimumProtocolVersion:
          cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        comment: `SyntheticSupabaseApp Frontend (${environment})`,
      },
    });

    const distribution = cloudfrontToS3.cloudFrontWebDistribution;

    // ---------------------------------------------------------------
    // 3. /api/* behavior — proxy to API Gateway (no caching, all methods)
    // ---------------------------------------------------------------
    const apiOrigin = new origins.HttpOrigin(apiGatewayDomain, {
      protocolPolicy: cloudfront.OriginProtocolPolicy.HTTPS_ONLY,
      originPath: '',
    });

    distribution.addBehavior('/api/*', apiOrigin, {
      allowedMethods: cloudfront.AllowedMethods.ALLOW_ALL,
      viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.HTTPS_ONLY,
      cachePolicy: cloudfront.CachePolicy.CACHING_DISABLED,
      originRequestPolicy:
        cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
    });

    // ---------------------------------------------------------------
    // 4. Deploy build output to S3 and invalidate CloudFront
    // ---------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(buildOutputPath)],
      destinationBucket: cloudfrontToS3.s3BucketInterface as cdk.aws_s3.IBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    // ---------------------------------------------------------------
    // 5. Outputs
    // ---------------------------------------------------------------
    this.distributionDomain = distribution.distributionDomainName;

    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
      exportName: `SyntheticSupabaseApp-${environment}-CloudFrontURL`,
    });

    new cdk.CfnOutput(this, 'S3BucketName', {
      value: cloudfrontToS3.s3BucketInterface.bucketName,
      description: 'S3 bucket for frontend assets',
      exportName: `SyntheticSupabaseApp-${environment}-S3BucketName`,
    });
  }
}
