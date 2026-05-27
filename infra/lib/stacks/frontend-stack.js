"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.FrontendStack = void 0;
const cdk = __importStar(require("aws-cdk-lib"));
const cloudfront = __importStar(require("aws-cdk-lib/aws-cloudfront"));
const origins = __importStar(require("aws-cdk-lib/aws-cloudfront-origins"));
const s3deploy = __importStar(require("aws-cdk-lib/aws-s3-deployment"));
const aws_cloudfront_s3_1 = require("@aws-solutions-constructs/aws-cloudfront-s3");
class FrontendStack extends cdk.Stack {
    distributionDomain;
    constructor(scope, id, props) {
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
        const cloudfrontToS3 = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
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
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
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
                minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
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
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        });
        // ---------------------------------------------------------------
        // 4. Deploy build output to S3 and invalidate CloudFront
        // ---------------------------------------------------------------
        new s3deploy.BucketDeployment(this, 'DeployFrontend', {
            sources: [s3deploy.Source.asset(buildOutputPath)],
            destinationBucket: cloudfrontToS3.s3BucketInterface,
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
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBUzdFLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFCLGtCQUFrQixDQUFTO0lBRTNDLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakUsa0VBQWtFO1FBQ2xFLG9FQUFvRTtRQUNwRSxrRUFBa0U7UUFDbEUsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDL0QsWUFBWSxFQUFFLDRCQUE0QixXQUFXLEVBQUU7WUFDdkQsSUFBSSxFQUFFLFVBQVUsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQXVCeEMsQ0FBQyxJQUFJLEVBQUUsQ0FBQztZQUNULE9BQU8sRUFBRSxVQUFVLENBQUMsZUFBZSxDQUFDLE1BQU07U0FDM0MsQ0FBQyxDQUFDO1FBRUgsa0VBQWtFO1FBQ2xFLGdFQUFnRTtRQUNoRSw4Q0FBOEM7UUFDOUMsa0VBQWtFO1FBQ2xFLE1BQU0sY0FBYyxHQUFHLElBQUksa0NBQWMsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDaEUseUJBQXlCLEVBQUUsS0FBSyxFQUFFLDhCQUE4QjtZQUNoRSwyQkFBMkIsRUFBRTtnQkFDM0IsZUFBZSxFQUFFO29CQUNmLDRFQUE0RTtv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RUFBRSwrQkFBK0I7WUFDNUMsVUFBVSxFQUFFLHdCQUF3QixXQUFXLGVBQWU7U0FDL0QsQ0FBQyxDQUFDO0lBQ0wsQ0FBQztDQUNGO0FBaklELHNDQWlJQyIsInNvdXJjZXNDb250ZW50IjpbImltcG9ydCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCc7XG5pbXBvcnQgeyBDbG91ZEZyb250VG9TMyB9IGZyb20gJ0Bhd3Mtc29sdXRpb25zLWNvbnN0cnVjdHMvYXdzLWNsb3VkZnJvbnQtczMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRnJvbnRlbmRTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xuICBidWlsZE91dHB1dFBhdGg6IHN0cmluZzsgLy8gZS5nLiBcIi4uL2Rpc3RcIlxuICBhcGlHYXRld2F5RG9tYWluOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBGcm9udGVuZFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGRpc3RyaWJ1dGlvbkRvbWFpbjogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBGcm9udGVuZFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGJ1aWxkT3V0cHV0UGF0aCwgYXBpR2F0ZXdheURvbWFpbiB9ID0gcHJvcHM7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAxLiBDU1AgQ2xvdWRGcm9udCBGdW5jdGlvbiAocGVybWlzc2l2ZSBmb3IgdGhpcmQtcGFydHkgQ0ROcy9BUElzKVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGNzcEZ1bmN0aW9uID0gbmV3IGNsb3VkZnJvbnQuRnVuY3Rpb24odGhpcywgJ0NzcEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgU3ludGhldGljU3VwYWJhc2VBcHAtQ1NQLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGNvZGU6IGNsb3VkZnJvbnQuRnVuY3Rpb25Db2RlLmZyb21JbmxpbmUoYFxuZnVuY3Rpb24gaGFuZGxlcihldmVudCkge1xuICB2YXIgcmVzcG9uc2UgPSBldmVudC5yZXNwb25zZTtcbiAgdmFyIGhlYWRlcnMgPSByZXNwb25zZS5oZWFkZXJzO1xuICBoZWFkZXJzWydjb250ZW50LXNlY3VyaXR5LXBvbGljeSddID0ge1xuICAgIHZhbHVlOiBbXG4gICAgICBcImRlZmF1bHQtc3JjICdzZWxmJ1wiLFxuICAgICAgXCJzY3JpcHQtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgJ3Vuc2FmZS1ldmFsJyBodHRwczpcIixcbiAgICAgIFwic3R5bGUtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgaHR0cHM6XCIsXG4gICAgICBcImltZy1zcmMgJ3NlbGYnIGRhdGE6IGh0dHBzOlwiLFxuICAgICAgXCJmb250LXNyYyAnc2VsZicgZGF0YTogaHR0cHM6XCIsXG4gICAgICBcImNvbm5lY3Qtc3JjICdzZWxmJyBodHRwczpcIixcbiAgICAgIFwiZnJhbWUtc3JjICdzZWxmJyBodHRwczpcIixcbiAgICAgIFwib2JqZWN0LXNyYyAnbm9uZSdcIixcbiAgICAgIFwiYmFzZS11cmkgJ3NlbGYnXCJcbiAgICBdLmpvaW4oJzsgJylcbiAgfTtcbiAgaGVhZGVyc1sneC1jb250ZW50LXR5cGUtb3B0aW9ucyddID0geyB2YWx1ZTogJ25vc25pZmYnIH07XG4gIGhlYWRlcnNbJ3gtZnJhbWUtb3B0aW9ucyddID0geyB2YWx1ZTogJ1NBTUVPUklHSU4nIH07XG4gIGhlYWRlcnNbJ3gteHNzLXByb3RlY3Rpb24nXSA9IHsgdmFsdWU6ICcxOyBtb2RlPWJsb2NrJyB9O1xuICBoZWFkZXJzWydyZWZlcnJlci1wb2xpY3knXSA9IHsgdmFsdWU6ICdzdHJpY3Qtb3JpZ2luLXdoZW4tY3Jvc3Mtb3JpZ2luJyB9O1xuICByZXR1cm4gcmVzcG9uc2U7XG59XG4gICAgICBgLnRyaW0oKSksXG4gICAgICBydW50aW1lOiBjbG91ZGZyb250LkZ1bmN0aW9uUnVudGltZS5KU18yXzAsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAyLiBDbG91ZEZyb250VG9TMyBzb2x1dGlvbiBjb25zdHJ1Y3Qg4oCUIFMzIGJ1Y2tldCArIENsb3VkRnJvbnRcbiAgICAvLyAgICBkaXN0cmlidXRpb24gd2l0aCBPQUMgYWxyZWFkeSBjb25maWd1cmVkXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgY2xvdWRmcm9udFRvUzMgPSBuZXcgQ2xvdWRGcm9udFRvUzModGhpcywgJ0Nsb3VkRnJvbnRUb1MzJywge1xuICAgICAgaW5zZXJ0SHR0cFNlY3VyaXR5SGVhZGVyczogZmFsc2UsIC8vIHdlIGFkZCBvdXIgb3duIENTUCBmdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICAgIC8vIENTUCBmdW5jdGlvbiBhdHRhY2hlZCB0byB0aGUgdmlld2VyLXJlc3BvbnNlIG9mIHRoZSBkZWZhdWx0IChTMykgYmVoYXZpb3JcbiAgICAgICAgICBmdW5jdGlvbkFzc29jaWF0aW9uczogW1xuICAgICAgICAgICAge1xuICAgICAgICAgICAgICBmdW5jdGlvbjogY3NwRnVuY3Rpb24sXG4gICAgICAgICAgICAgIGV2ZW50VHlwZTogY2xvdWRmcm9udC5GdW5jdGlvbkV2ZW50VHlwZS5WSUVXRVJfUkVTUE9OU0UsXG4gICAgICAgICAgICB9LFxuICAgICAgICAgIF0sXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6XG4gICAgICAgICAgICBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgICB9LFxuICAgICAgICAvLyBTUEEgZXJyb3IgcmVzcG9uc2VzOiA0MDMgLyA0MDQg4oaSIC9pbmRleC5odG1sIHdpdGggMjAwXG4gICAgICAgIGVycm9yUmVzcG9uc2VzOiBbXG4gICAgICAgICAge1xuICAgICAgICAgICAgaHR0cFN0YXR1czogNDAzLFxuICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgICAgdHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgICB9LFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwNCxcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgICAgfSxcbiAgICAgICAgXSxcbiAgICAgICAgLy8gSFRUUC8yICsgSFRUUC8zLCBjaGVhcGVzdCBwcmljZSBjbGFzc1xuICAgICAgICBodHRwVmVyc2lvbjogY2xvdWRmcm9udC5IdHRwVmVyc2lvbi5IVFRQMl9BTkRfMyxcbiAgICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTXzEwMCxcbiAgICAgICAgbWluaW11bVByb3RvY29sVmVyc2lvbjpcbiAgICAgICAgICBjbG91ZGZyb250LlNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgY29tbWVudDogYFN5bnRoZXRpY1N1cGFiYXNlQXBwIEZyb250ZW5kICgke2Vudmlyb25tZW50fSlgLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IGNsb3VkZnJvbnRUb1MzLmNsb3VkRnJvbnRXZWJEaXN0cmlidXRpb247XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAzLiAvYXBpLyogYmVoYXZpb3Ig4oCUIHByb3h5IHRvIEFQSSBHYXRld2F5IChubyBjYWNoaW5nLCBhbGwgbWV0aG9kcylcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBhcGlPcmlnaW4gPSBuZXcgb3JpZ2lucy5IdHRwT3JpZ2luKGFwaUdhdGV3YXlEb21haW4sIHtcbiAgICAgIHByb3RvY29sUG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXG4gICAgICBvcmlnaW5QYXRoOiAnJyxcbiAgICB9KTtcblxuICAgIGRpc3RyaWJ1dGlvbi5hZGRCZWhhdmlvcignL2FwaS8qJywgYXBpT3JpZ2luLCB7XG4gICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19BTEwsXG4gICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcbiAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6XG4gICAgICAgIGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSX0VYQ0VQVF9IT1NUX0hFQURFUixcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDQuIERlcGxveSBidWlsZCBvdXRwdXQgdG8gUzMgYW5kIGludmFsaWRhdGUgQ2xvdWRGcm9udFxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIG5ldyBzM2RlcGxveS5CdWNrZXREZXBsb3ltZW50KHRoaXMsICdEZXBsb3lGcm9udGVuZCcsIHtcbiAgICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoYnVpbGRPdXRwdXRQYXRoKV0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogY2xvdWRmcm9udFRvUzMuczNCdWNrZXRJbnRlcmZhY2UgYXMgY2RrLmF3c19zMy5JQnVja2V0LFxuICAgICAgZGlzdHJpYnV0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uUGF0aHM6IFsnLyonXSxcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyA1LiBPdXRwdXRzXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgdGhpcy5kaXN0cmlidXRpb25Eb21haW4gPSBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZEZyb250VVJMJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gVVJMJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBTeW50aGV0aWNTdXBhYmFzZUFwcC0ke2Vudmlyb25tZW50fS1DbG91ZEZyb250VVJMYCxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdTM0J1Y2tldE5hbWUnLCB7XG4gICAgICB2YWx1ZTogY2xvdWRmcm9udFRvUzMuczNCdWNrZXRJbnRlcmZhY2UuYnVja2V0TmFtZSxcbiAgICAgIGRlc2NyaXB0aW9uOiAnUzMgYnVja2V0IGZvciBmcm9udGVuZCBhc3NldHMnLFxuICAgICAgZXhwb3J0TmFtZTogYFN5bnRoZXRpY1N1cGFiYXNlQXBwLSR7ZW52aXJvbm1lbnR9LVMzQnVja2V0TmFtZWAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==