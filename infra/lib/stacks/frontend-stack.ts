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

    // -------------------------------------------------------------------------
    // 1. CSP CloudFront Function — permissive policy for third-party CDNs/APIs
    // -------------------------------------------------------------------------
    const cspFunction = new cloudfront.Function(this, 'CspFunction', {
      code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['content-security-policy'] = {
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-ancestors 'none';"
  };
  headers['x-content-type-options'] = { value: 'nosniff' };
  headers['x-frame-options'] = { value: 'DENY' };
  headers['x-xss-protection'] = { value: '1; mode=block' };
  headers['referrer-policy'] = { value: 'strict-origin-when-cross-origin' };
  return response;
}
      `),
      functionName: `SyntheticSupabaseApp-CSP-${environment}`,
      comment: 'Adds CSP and security headers to all responses',
    });

    // -------------------------------------------------------------------------
    // 2. CloudFrontToS3 solution construct — S3 bucket + CloudFront with OAC
    // -------------------------------------------------------------------------
    const frontendConstruct = new CloudFrontToS3(this, 'CloudFrontToS3', {
      insertHttpSecurityHeaders: false, // We handle headers via our own CF Function
      cloudFrontDistributionProps: {
        defaultBehavior: {
          allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
          viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
          cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
          functionAssociations: [
            {
              function: cspFunction,
              eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
            },
          ],
        },
        errorResponses: [
          // SPA client-side routing: redirect 403/404 back to index.html
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
        httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
        minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
        priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
        comment: `SyntheticSupabaseApp Frontend - ${environment}`,
      },
    });

    const distribution = frontendConstruct.cloudFrontWebDistribution;

    // -------------------------------------------------------------------------
    // 3. /api/* behavior — proxy to API Gateway (caching disabled)
    // -------------------------------------------------------------------------
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

    // -------------------------------------------------------------------------
    // 4. BucketDeployment — sync build output to S3 + invalidate CloudFront
    // -------------------------------------------------------------------------
    new s3deploy.BucketDeployment(this, 'DeployFrontend', {
      sources: [s3deploy.Source.asset(buildOutputPath)],
      destinationBucket: frontendConstruct.s3BucketInterface as cdk.aws_s3.IBucket,
      distribution,
      distributionPaths: ['/*'],
      memoryLimit: 512,
    });

    this.distributionDomainName = distribution.distributionDomainName;

    // -------------------------------------------------------------------------
    // 5. Stack outputs
    // -------------------------------------------------------------------------
    new cdk.CfnOutput(this, 'CloudFrontURL', {
      value: `https://${distribution.distributionDomainName}`,
      description: 'CloudFront distribution URL',
      exportName: `SyntheticSupabaseApp-Frontend-URL-${environment}`,
    });

    new cdk.CfnOutput(this, 'CloudFrontDistributionId', {
      value: distribution.distributionId,
      description: 'CloudFront Distribution ID',
      exportName: `SyntheticSupabaseApp-Frontend-DistributionId-${environment}`,
    });
  }
}
