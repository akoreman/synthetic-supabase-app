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
        // 1. CSP CloudFront Function — permissive policy allowing third-party CDNs/APIs
        const cspFunction = new cloudfront.Function(this, 'CspFunction', {
            functionName: `synthetic-supabase-app-${environment}-csp`,
            code: cloudfront.FunctionCode.fromInline(`
function handler(event) {
  var response = event.response;
  var headers = response.headers;
  headers['content-security-policy'] = {
    value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https:; style-src 'self' 'unsafe-inline' https:; img-src 'self' data: https:; font-src 'self' data: https:; connect-src 'self' https:; frame-src 'self' https:; object-src 'none'; base-uri 'self';"
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
        // 2. Use CloudFrontToS3 solution construct for S3 bucket + CloudFront distribution with OAC
        const cloudFrontToS3 = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
            insertHttpSecurityHeaders: false, // We manage headers via our own CSP function
            cloudFrontDistributionProps: {
                defaultBehavior: {
                    viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
                    allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD_OPTIONS,
                    cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
                    functionAssociations: [
                        {
                            function: cspFunction,
                            eventType: cloudfront.FunctionEventType.VIEWER_RESPONSE,
                        },
                    ],
                },
                // SPA error responses: 403/404 → /index.html with 200 status
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
                // HTTP/2+3, TLS 1.2, Price Class 100 (US/EU)
                httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
                minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
                priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
                comment: `synthetic-supabase-app-${environment} frontend distribution`,
            },
        });
        const distribution = cloudFrontToS3.cloudFrontWebDistribution;
        // 3. Add /api/* behavior proxying to API Gateway origin
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
        this.distributionDomainName = distribution.distributionDomainName;
        // 4. BucketDeployment to sync build output to S3 with CloudFront invalidation
        new s3deploy.BucketDeployment(this, 'DeployFrontend', {
            sources: [s3deploy.Source.asset(buildOutputPath)],
            destinationBucket: cloudFrontToS3.s3BucketInterface,
            distribution,
            distributionPaths: ['/*'],
            memoryLimit: 512,
            prune: true,
        });
        // 5. Outputs
        new cdk.CfnOutput(this, 'CloudFrontDomainName', {
            value: distribution.distributionDomainName,
            description: 'CloudFront distribution domain name',
            exportName: `synthetic-supabase-app-${environment}-cf-domain`,
        });
        new cdk.CfnOutput(this, 'CloudFrontUrl', {
            value: `https://${distribution.distributionDomainName}`,
            description: 'CloudFront distribution URL',
            exportName: `synthetic-supabase-app-${environment}-cf-url`,
        });
    }
}
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBUzdFLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFCLHNCQUFzQixDQUFTO0lBRS9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakUsZ0ZBQWdGO1FBQ2hGLE1BQU0sV0FBVyxHQUFHLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQy9ELFlBQVksRUFBRSwwQkFBMEIsV0FBVyxNQUFNO1lBQ3pELElBQUksRUFBRSxVQUFVLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7OztPQWF4QyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1QsT0FBTyxFQUFFLFVBQVUsQ0FBQyxlQUFlLENBQUMsTUFBTTtTQUMzQyxDQUFDLENBQUM7UUFFSCw0RkFBNEY7UUFDNUYsTUFBTSxjQUFjLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNoRSx5QkFBeUIsRUFBRSxLQUFLLEVBQUUsNkNBQTZDO1lBQy9FLDJCQUEyQixFQUFFO2dCQUMzQixlQUFlLEVBQUU7b0JBQ2Ysb0JBQW9CLEVBQUUsVUFBVSxDQUFDLG9CQUFvQixDQUFDLGlCQUFpQjtvQkFDdkUsY0FBYyxFQUFFLFVBQVUsQ0FBQyxjQUFjLENBQUMsc0JBQXNC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dCAqIGFzIGNkayBmcm9tICdhd3MtY2RrLWxpYic7XG5pbXBvcnQgKiBhcyBjbG91ZGZyb250IGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250JztcbmltcG9ydCAqIGFzIG9yaWdpbnMgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQtb3JpZ2lucyc7XG5pbXBvcnQgKiBhcyBzM2RlcGxveSBmcm9tICdhd3MtY2RrLWxpYi9hd3MtczMtZGVwbG95bWVudCc7XG5pbXBvcnQgeyBDbG91ZEZyb250VG9TMyB9IGZyb20gJ0Bhd3Mtc29sdXRpb25zLWNvbnN0cnVjdHMvYXdzLWNsb3VkZnJvbnQtczMnO1xuaW1wb3J0IHsgQ29uc3RydWN0IH0gZnJvbSAnY29uc3RydWN0cyc7XG5cbmV4cG9ydCBpbnRlcmZhY2UgRnJvbnRlbmRTdGFja1Byb3BzIGV4dGVuZHMgY2RrLlN0YWNrUHJvcHMge1xuICBlbnZpcm9ubWVudDogc3RyaW5nO1xuICBidWlsZE91dHB1dFBhdGg6IHN0cmluZzsgLy8gZS5nLiBcIi4uL2Rpc3RcIlxuICBhcGlHYXRld2F5RG9tYWluOiBzdHJpbmc7XG59XG5cbmV4cG9ydCBjbGFzcyBGcm9udGVuZFN0YWNrIGV4dGVuZHMgY2RrLlN0YWNrIHtcbiAgcHVibGljIHJlYWRvbmx5IGRpc3RyaWJ1dGlvbkRvbWFpbk5hbWU6IHN0cmluZztcblxuICBjb25zdHJ1Y3RvcihzY29wZTogQ29uc3RydWN0LCBpZDogc3RyaW5nLCBwcm9wczogRnJvbnRlbmRTdGFja1Byb3BzKSB7XG4gICAgc3VwZXIoc2NvcGUsIGlkLCBwcm9wcyk7XG5cbiAgICBjb25zdCB7IGVudmlyb25tZW50LCBidWlsZE91dHB1dFBhdGgsIGFwaUdhdGV3YXlEb21haW4gfSA9IHByb3BzO1xuXG4gICAgLy8gMS4gQ1NQIENsb3VkRnJvbnQgRnVuY3Rpb24g4oCUIHBlcm1pc3NpdmUgcG9saWN5IGFsbG93aW5nIHRoaXJkLXBhcnR5IENETnMvQVBJc1xuICAgIGNvbnN0IGNzcEZ1bmN0aW9uID0gbmV3IGNsb3VkZnJvbnQuRnVuY3Rpb24odGhpcywgJ0NzcEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgc3ludGhldGljLXN1cGFiYXNlLWFwcC0ke2Vudmlyb25tZW50fS1jc3BgLFxuICAgICAgY29kZTogY2xvdWRmcm9udC5GdW5jdGlvbkNvZGUuZnJvbUlubGluZShgXG5mdW5jdGlvbiBoYW5kbGVyKGV2ZW50KSB7XG4gIHZhciByZXNwb25zZSA9IGV2ZW50LnJlc3BvbnNlO1xuICB2YXIgaGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnM7XG4gIGhlYWRlcnNbJ2NvbnRlbnQtc2VjdXJpdHktcG9saWN5J10gPSB7XG4gICAgdmFsdWU6IFwiZGVmYXVsdC1zcmMgJ3NlbGYnOyBzY3JpcHQtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgJ3Vuc2FmZS1ldmFsJyBodHRwczo7IHN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnIGh0dHBzOjsgaW1nLXNyYyAnc2VsZicgZGF0YTogaHR0cHM6OyBmb250LXNyYyAnc2VsZicgZGF0YTogaHR0cHM6OyBjb25uZWN0LXNyYyAnc2VsZicgaHR0cHM6OyBmcmFtZS1zcmMgJ3NlbGYnIGh0dHBzOjsgb2JqZWN0LXNyYyAnbm9uZSc7IGJhc2UtdXJpICdzZWxmJztcIlxuICB9O1xuICBoZWFkZXJzWyd4LWNvbnRlbnQtdHlwZS1vcHRpb25zJ10gPSB7IHZhbHVlOiAnbm9zbmlmZicgfTtcbiAgaGVhZGVyc1sneC1mcmFtZS1vcHRpb25zJ10gPSB7IHZhbHVlOiAnU0FNRU9SSUdJTicgfTtcbiAgaGVhZGVyc1sneC14c3MtcHJvdGVjdGlvbiddID0geyB2YWx1ZTogJzE7IG1vZGU9YmxvY2snIH07XG4gIGhlYWRlcnNbJ3JlZmVycmVyLXBvbGljeSddID0geyB2YWx1ZTogJ3N0cmljdC1vcmlnaW4td2hlbi1jcm9zcy1vcmlnaW4nIH07XG4gIHJldHVybiByZXNwb25zZTtcbn1cbiAgICAgIGAudHJpbSgpKSxcbiAgICAgIHJ1bnRpbWU6IGNsb3VkZnJvbnQuRnVuY3Rpb25SdW50aW1lLkpTXzJfMCxcbiAgICB9KTtcblxuICAgIC8vIDIuIFVzZSBDbG91ZEZyb250VG9TMyBzb2x1dGlvbiBjb25zdHJ1Y3QgZm9yIFMzIGJ1Y2tldCArIENsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIHdpdGggT0FDXG4gICAgY29uc3QgY2xvdWRGcm9udFRvUzMgPSBuZXcgQ2xvdWRGcm9udFRvUzModGhpcywgJ0Nsb3VkRnJvbnRUb1MzJywge1xuICAgICAgaW5zZXJ0SHR0cFNlY3VyaXR5SGVhZGVyczogZmFsc2UsIC8vIFdlIG1hbmFnZSBoZWFkZXJzIHZpYSBvdXIgb3duIENTUCBmdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0dFVF9IRUFEX09QVElPTlMsXG4gICAgICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19PUFRJTUlaRUQsXG4gICAgICAgICAgZnVuY3Rpb25Bc3NvY2lhdGlvbnM6IFtcbiAgICAgICAgICAgIHtcbiAgICAgICAgICAgICAgZnVuY3Rpb246IGNzcEZ1bmN0aW9uLFxuICAgICAgICAgICAgICBldmVudFR5cGU6IGNsb3VkZnJvbnQuRnVuY3Rpb25FdmVudFR5cGUuVklFV0VSX1JFU1BPTlNFLFxuICAgICAgICAgICAgfSxcbiAgICAgICAgICBdLFxuICAgICAgICB9LFxuICAgICAgICAvLyBTUEEgZXJyb3IgcmVzcG9uc2VzOiA0MDMvNDA0IOKGkiAvaW5kZXguaHRtbCB3aXRoIDIwMCBzdGF0dXNcbiAgICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgICAgdHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyBIVFRQLzIrMywgVExTIDEuMiwgUHJpY2UgQ2xhc3MgMTAwIChVUy9FVSlcbiAgICAgICAgaHR0cFZlcnNpb246IGNsb3VkZnJvbnQuSHR0cFZlcnNpb24uSFRUUDJfQU5EXzMsXG4gICAgICAgIG1pbmltdW1Qcm90b2NvbFZlcnNpb246IGNsb3VkZnJvbnQuU2VjdXJpdHlQb2xpY3lQcm90b2NvbC5UTFNfVjFfMl8yMDIxLFxuICAgICAgICBwcmljZUNsYXNzOiBjbG91ZGZyb250LlByaWNlQ2xhc3MuUFJJQ0VfQ0xBU1NfMTAwLFxuICAgICAgICBjb21tZW50OiBgc3ludGhldGljLXN1cGFiYXNlLWFwcC0ke2Vudmlyb25tZW50fSBmcm9udGVuZCBkaXN0cmlidXRpb25gLFxuICAgICAgfSxcbiAgICB9KTtcblxuICAgIGNvbnN0IGRpc3RyaWJ1dGlvbiA9IGNsb3VkRnJvbnRUb1MzLmNsb3VkRnJvbnRXZWJEaXN0cmlidXRpb247XG5cbiAgICAvLyAzLiBBZGQgL2FwaS8qIGJlaGF2aW9yIHByb3h5aW5nIHRvIEFQSSBHYXRld2F5IG9yaWdpblxuICAgIGNvbnN0IGFwaU9yaWdpbiA9IG5ldyBvcmlnaW5zLkh0dHBPcmlnaW4oYXBpR2F0ZXdheURvbWFpbiwge1xuICAgICAgcHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgICAgIG9yaWdpblBhdGg6ICcnLFxuICAgIH0pO1xuXG4gICAgZGlzdHJpYnV0aW9uLmFkZEJlaGF2aW9yKCcvYXBpLyonLCBhcGlPcmlnaW4sIHtcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcbiAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXG4gICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTpcbiAgICAgICAgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJfRVhDRVBUX0hPU1RfSEVBREVSLFxuICAgIH0pO1xuXG4gICAgdGhpcy5kaXN0cmlidXRpb25Eb21haW5OYW1lID0gZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWU7XG5cbiAgICAvLyA0LiBCdWNrZXREZXBsb3ltZW50IHRvIHN5bmMgYnVpbGQgb3V0cHV0IHRvIFMzIHdpdGggQ2xvdWRGcm9udCBpbnZhbGlkYXRpb25cbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95RnJvbnRlbmQnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KGJ1aWxkT3V0cHV0UGF0aCldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IGNsb3VkRnJvbnRUb1MzLnMzQnVja2V0SW50ZXJmYWNlIGFzIGNkay5hd3NfczMuSUJ1Y2tldCxcbiAgICAgIGRpc3RyaWJ1dGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvblBhdGhzOiBbJy8qJ10sXG4gICAgICBtZW1vcnlMaW1pdDogNTEyLFxuICAgICAgcHJ1bmU6IHRydWUsXG4gICAgfSk7XG5cbiAgICAvLyA1LiBPdXRwdXRzXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnREb21haW5OYW1lJywge1xuICAgICAgdmFsdWU6IGRpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBkb21haW4gbmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgc3ludGhldGljLXN1cGFiYXNlLWFwcC0ke2Vudmlyb25tZW50fS1jZi1kb21haW5gLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnRVcmwnLCB7XG4gICAgICB2YWx1ZTogYGh0dHBzOi8vJHtkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBVUkwnLFxuICAgICAgZXhwb3J0TmFtZTogYHN5bnRoZXRpYy1zdXBhYmFzZS1hcHAtJHtlbnZpcm9ubWVudH0tY2YtdXJsYCxcbiAgICB9KTtcbiAgfVxufVxuIl19