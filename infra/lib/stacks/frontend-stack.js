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
    distributionDomainName;
    constructor(scope, id, props) {
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
        const frontendConstruct = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
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
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        });
        // -------------------------------------------------------------------------
        // 4. BucketDeployment — sync build output to S3 + invalidate CloudFront
        // -------------------------------------------------------------------------
        new s3deploy.BucketDeployment(this, 'DeployFrontend', {
            sources: [s3deploy.Source.asset(buildOutputPath)],
            destinationBucket: frontendConstruct.s3BucketInterface,
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
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBUzdFLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFCLHNCQUFzQixDQUFTO0lBRS9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakUsNEVBQTRFO1FBQzVFLDJFQUEyRTtRQUMzRSw0RUFBNEU7UUFDNUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDL0QsSUFBSSxFQUFFLFVBQVUsQ0FBQyxZQUFZLENBQUMsVUFBVSxDQUFDOzs7Ozs7Ozs7Ozs7O09BYXhDLENBQUM7WUFDRixZQUFZLEVBQUUsNEJBQTRCLFdBQVcsRUFBRTtZQUN2RCxPQUFPLEVBQUUsZ0RBQWdEO1NBQzFELENBQUMsQ0FBQztRQUVILDRFQUE0RTtRQUM1RSx5RUFBeUU7UUFDekUsNEVBQTRFO1FBQzVFLE1BQU0saUJBQWlCLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNuRSx5QkFBeUIsRUFBRSxLQUFLLEVBQUUsNENBQTRDO1lBQzlFLDJCQUEyQixFQUFFO2dCQUMzQixlQUFlLEVBQUU7b0JBQ2YsY0FBYyxFQUFFLFVBQVUsQ0FBQyxjQUFjLENBQUMsc0JBQXNCO29CQUNoRSxvQkFBb0IsRUFBRSxVQUFVLENB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QUMxRSxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUFuSEQsc0NBbUhDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJztcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcbmltcG9ydCB7IENsb3VkRnJvbnRUb1MzIH0gZnJvbSAnQGF3cy1zb2x1dGlvbnMtY29uc3RydWN0cy9hd3MtY2xvdWRmcm9udC1zMyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBGcm9udGVuZFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG4gIGJ1aWxkT3V0cHV0UGF0aDogc3RyaW5nOyAvLyBlLmcuIFwiLi4vZGlzdFwiXG4gIGFwaUdhdGV3YXlEb21haW46IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEZyb250ZW5kU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZGlzdHJpYnV0aW9uRG9tYWluTmFtZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBGcm9udGVuZFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGJ1aWxkT3V0cHV0UGF0aCwgYXBpR2F0ZXdheURvbWFpbiB9ID0gcHJvcHM7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMS4gQ1NQIENsb3VkRnJvbnQgRnVuY3Rpb24g4oCUIHBlcm1pc3NpdmUgcG9saWN5IGZvciB0aGlyZC1wYXJ0eSBDRE5zL0FQSXNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgY3NwRnVuY3Rpb24gPSBuZXcgY2xvdWRmcm9udC5GdW5jdGlvbih0aGlzLCAnQ3NwRnVuY3Rpb24nLCB7XG4gICAgICBjb2RlOiBjbG91ZGZyb250LkZ1bmN0aW9uQ29kZS5mcm9tSW5saW5lKGBcbmZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQpIHtcbiAgdmFyIHJlc3BvbnNlID0gZXZlbnQucmVzcG9uc2U7XG4gIHZhciBoZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVycztcbiAgaGVhZGVyc1snY29udGVudC1zZWN1cml0eS1wb2xpY3knXSA9IHtcbiAgICB2YWx1ZTogXCJkZWZhdWx0LXNyYyAnc2VsZic7IHNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyAndW5zYWZlLWV2YWwnIGh0dHBzOjsgc3R5bGUtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgaHR0cHM6OyBpbWctc3JjICdzZWxmJyBkYXRhOiBodHRwczo7IGZvbnQtc3JjICdzZWxmJyBkYXRhOiBodHRwczo7IGNvbm5lY3Qtc3JjICdzZWxmJyBodHRwczo7IGZyYW1lLWFuY2VzdG9ycyAnbm9uZSc7XCJcbiAgfTtcbiAgaGVhZGVyc1sneC1jb250ZW50LXR5cGUtb3B0aW9ucyddID0geyB2YWx1ZTogJ25vc25pZmYnIH07XG4gIGhlYWRlcnNbJ3gtZnJhbWUtb3B0aW9ucyddID0geyB2YWx1ZTogJ0RFTlknIH07XG4gIGhlYWRlcnNbJ3gteHNzLXByb3RlY3Rpb24nXSA9IHsgdmFsdWU6ICcxOyBtb2RlPWJsb2NrJyB9O1xuICBoZWFkZXJzWydyZWZlcnJlci1wb2xpY3knXSA9IHsgdmFsdWU6ICdzdHJpY3Qtb3JpZ2luLXdoZW4tY3Jvc3Mtb3JpZ2luJyB9O1xuICByZXR1cm4gcmVzcG9uc2U7XG59XG4gICAgICBgKSxcbiAgICAgIGZ1bmN0aW9uTmFtZTogYFN5bnRoZXRpY1N1cGFiYXNlQXBwLUNTUC0ke2Vudmlyb25tZW50fWAsXG4gICAgICBjb21tZW50OiAnQWRkcyBDU1AgYW5kIHNlY3VyaXR5IGhlYWRlcnMgdG8gYWxsIHJlc3BvbnNlcycsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMi4gQ2xvdWRGcm9udFRvUzMgc29sdXRpb24gY29uc3RydWN0IOKAlCBTMyBidWNrZXQgKyBDbG91ZEZyb250IHdpdGggT0FDXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGZyb250ZW5kQ29uc3RydWN0ID0gbmV3IENsb3VkRnJvbnRUb1MzKHRoaXMsICdDbG91ZEZyb250VG9TMycsIHtcbiAgICAgIGluc2VydEh0dHBTZWN1cml0eUhlYWRlcnM6IGZhbHNlLCAvLyBXZSBoYW5kbGUgaGVhZGVycyB2aWEgb3VyIG93biBDRiBGdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuUkVESVJFQ1RfVE9fSFRUUFMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgZnVuY3Rpb25Bc3NvY2lhdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZnVuY3Rpb246IGNzcEZ1bmN0aW9uLFxuICAgICAgICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuRnVuY3Rpb25FdmVudFR5cGUuVklFV0VSX1JFU1BPTlNFLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAgIC8vIFNQQSBjbGllbnQtc2lkZSByb3V0aW5nOiByZWRpcmVjdCA0MDMvNDA0IGJhY2sgdG8gaW5kZXguaHRtbFxuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDQsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIGh0dHBWZXJzaW9uOiBjbG91ZGZyb250Lkh0dHBWZXJzaW9uLkhUVFAyX0FORF8zLFxuICAgICAgICBtaW5pbXVtUHJvdG9jb2xWZXJzaW9uOiBjbG91ZGZyb250LlNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTXzEwMCxcbiAgICAgICAgY29tbWVudDogYFN5bnRoZXRpY1N1cGFiYXNlQXBwIEZyb250ZW5kIC0gJHtlbnZpcm9ubWVudH1gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IGZyb250ZW5kQ29uc3RydWN0LmNsb3VkRnJvbnRXZWJEaXN0cmlidXRpb247XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMy4gL2FwaS8qIGJlaGF2aW9yIOKAlCBwcm94eSB0byBBUEkgR2F0ZXdheSAoY2FjaGluZyBkaXNhYmxlZClcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgYXBpT3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlHYXRld2F5RG9tYWluLCB7XG4gICAgICBwcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgb3JpZ2luUGF0aDogJycsXG4gICAgfSk7XG5cbiAgICBkaXN0cmlidXRpb24uYWRkQmVoYXZpb3IoJy9hcGkvKicsIGFwaU9yaWdpbiwge1xuICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OlxuICAgICAgICBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQUxMX1ZJRVdFUl9FWENFUFRfSE9TVF9IRUFERVIsXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNC4gQnVja2V0RGVwbG95bWVudCDigJQgc3luYyBidWlsZCBvdXRwdXQgdG8gUzMgKyBpbnZhbGlkYXRlIENsb3VkRnJvbnRcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveUZyb250ZW5kJywge1xuICAgICAgc291cmNlczogW3MzZGVwbG95LlNvdXJjZS5hc3NldChidWlsZE91dHB1dFBhdGgpXSxcbiAgICAgIGRlc3RpbmF0aW9uQnVja2V0OiBmcm9udGVuZENvbnN0cnVjdC5zM0J1Y2tldEludGVyZmFjZSBhcyBjZGsuYXdzX3MzLklCdWNrZXQsXG4gICAgICBkaXN0cmlidXRpb24sXG4gICAgICBkaXN0cmlidXRpb25QYXRoczogWycvKiddLFxuICAgICAgbWVtb3J5TGltaXQ6IDUxMixcbiAgICB9KTtcblxuICAgIHRoaXMuZGlzdHJpYnV0aW9uRG9tYWluTmFtZSA9IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDUuIFN0YWNrIG91dHB1dHNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnRVUkwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYFN5bnRoZXRpY1N1cGFiYXNlQXBwLUZyb250ZW5kLVVSTC0ke2Vudmlyb25tZW50fWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udERpc3RyaWJ1dGlvbklkJywge1xuICAgICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25JZCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBEaXN0cmlidXRpb24gSUQnLFxuICAgICAgZXhwb3J0TmFtZTogYFN5bnRoZXRpY1N1cGFiYXNlQXBwLUZyb250ZW5kLURpc3RyaWJ1dGlvbklkLSR7ZW52aXJvbm1lbnR9YCxcbiAgICB9KTtcbiAgfVxufVxuIl19