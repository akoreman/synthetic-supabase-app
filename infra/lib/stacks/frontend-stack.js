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
        const cloudFrontToS3 = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
            insertHttpSecurityHeaders: false, // We manage headers via our CSP Function
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
                minimumProtocolVersion: cloudfront.SecurityPolicyProtocol.TLS_V1_2_2021,
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
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        });
        this.distributionDomainName =
            cloudFrontToS3.cloudFrontWebDistribution.distributionDomainName;
        // -----------------------------------------------------------------------
        // 4. BucketDeployment — sync build output to S3 + CloudFront invalidation
        // -----------------------------------------------------------------------
        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset(buildOutputPath)],
            destinationBucket: cloudFrontToS3.s3BucketInterface,
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
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBUzdFLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFCLHNCQUFzQixDQUFTO0lBRS9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakUsMEVBQTBFO1FBQzFFLDJFQUEyRTtRQUMzRSwwRUFBMEU7UUFDMUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDL0QsWUFBWSxFQUFFLGVBQWUsV0FBVyxFQUFFO1lBQzFDLElBQUksRUFBRSxVQUFVLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7OztPQW1CeEMsQ0FBQztZQUNGLE9BQU8sRUFBRSxVQUFVLENBQUMsZUFBZSxDQUFDLE1BQU07U0FDM0MsQ0FBQyxDQUFDO1FBRUgsMEVBQTBFO1FBQzFFLHlFQUF5RTtRQUN6RSwwRUFBMEU7UUFDMUUsTUFBTSxjQUFjLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNoRSx5QkFBeUIsRUFBRSxLQUFLLEVBQUUseUNBQXlDO1lBQzNFLDJCQUEyQixFQUFFO2dCQUMzQixlQUFlLEVBQUU7b0JBQ2Ysb0JBQW9CLEVBQ2xCLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxpQkFBaUI7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QUFFLEdBQUcsRUFBRSxhQUFhO1NBQy9CLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTNIRCxzQ0EySEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0IHsgQ2xvdWRGcm9udFRvUzMgfSBmcm9tICdAYXdzLXNvbHV0aW9ucy1jb25zdHJ1Y3RzL2F3cy1jbG91ZGZyb250LXMzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuXG5leHBvcnQgaW50ZXJmYWNlIEZyb250ZW5kU3RhY2tQcm9wcyBleHRlbmRzIGNkay5TdGFja1Byb3BzIHtcbiAgZW52aXJvbm1lbnQ6IHN0cmluZztcbiAgYnVpbGRPdXRwdXRQYXRoOiBzdHJpbmc7IC8vIGUuZy4gXCIuLi9kaXN0XCJcbiAgYXBpR2F0ZXdheURvbWFpbjogc3RyaW5nO1xufVxuXG5leHBvcnQgY2xhc3MgRnJvbnRlbmRTdGFjayBleHRlbmRzIGNkay5TdGFjayB7XG4gIHB1YmxpYyByZWFkb25seSBkaXN0cmlidXRpb25Eb21haW5OYW1lOiBzdHJpbmc7XG5cbiAgY29uc3RydWN0b3Ioc2NvcGU6IENvbnN0cnVjdCwgaWQ6IHN0cmluZywgcHJvcHM6IEZyb250ZW5kU3RhY2tQcm9wcykge1xuICAgIHN1cGVyKHNjb3BlLCBpZCwgcHJvcHMpO1xuXG4gICAgY29uc3QgeyBlbnZpcm9ubWVudCwgYnVpbGRPdXRwdXRQYXRoLCBhcGlHYXRld2F5RG9tYWluIH0gPSBwcm9wcztcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMS4gQ1NQIENsb3VkRnJvbnQgRnVuY3Rpb24gKHBlcm1pc3NpdmUgcG9saWN5IGZvciB0aGlyZC1wYXJ0eSBDRE5zL0FQSXMpXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBjb25zdCBjc3BGdW5jdGlvbiA9IG5ldyBjbG91ZGZyb250LkZ1bmN0aW9uKHRoaXMsICdDc3BGdW5jdGlvbicsIHtcbiAgICAgIGZ1bmN0aW9uTmFtZTogYGNzcC1oZWFkZXJzLSR7ZW52aXJvbm1lbnR9YCxcbiAgICAgIGNvZGU6IGNsb3VkZnJvbnQuRnVuY3Rpb25Db2RlLmZyb21JbmxpbmUoYFxuZnVuY3Rpb24gaGFuZGxlcihldmVudCkge1xuICB2YXIgcmVzcG9uc2UgPSBldmVudC5yZXNwb25zZTtcbiAgdmFyIGhlYWRlcnMgPSByZXNwb25zZS5oZWFkZXJzO1xuICBoZWFkZXJzWydjb250ZW50LXNlY3VyaXR5LXBvbGljeSddID0ge1xuICAgIHZhbHVlOiBcImRlZmF1bHQtc3JjICdzZWxmJzsgXCIgK1xuICAgICAgICAgICBcInNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyAndW5zYWZlLWV2YWwnIGh0dHBzOjsgXCIgK1xuICAgICAgICAgICBcInN0eWxlLXNyYyAnc2VsZicgJ3Vuc2FmZS1pbmxpbmUnIGh0dHBzOjsgXCIgK1xuICAgICAgICAgICBcImltZy1zcmMgJ3NlbGYnIGRhdGE6IGh0dHBzOjsgXCIgK1xuICAgICAgICAgICBcImZvbnQtc3JjICdzZWxmJyBkYXRhOiBodHRwczo7IFwiICtcbiAgICAgICAgICAgXCJjb25uZWN0LXNyYyAnc2VsZicgaHR0cHM6OyBcIiArXG4gICAgICAgICAgIFwiZnJhbWUtc3JjICdzZWxmJyBodHRwczo7IFwiICtcbiAgICAgICAgICAgXCJvYmplY3Qtc3JjICdub25lJztcIlxuICB9O1xuICBoZWFkZXJzWyd4LWNvbnRlbnQtdHlwZS1vcHRpb25zJ10gPSB7IHZhbHVlOiAnbm9zbmlmZicgfTtcbiAgaGVhZGVyc1sneC1mcmFtZS1vcHRpb25zJ10gPSB7IHZhbHVlOiAnU0FNRU9SSUdJTicgfTtcbiAgaGVhZGVyc1sneC14c3MtcHJvdGVjdGlvbiddID0geyB2YWx1ZTogJzE7IG1vZGU9YmxvY2snIH07XG4gIHJldHVybiByZXNwb25zZTtcbn1cbiAgICAgIGApLFxuICAgICAgcnVudGltZTogY2xvdWRmcm9udC5GdW5jdGlvblJ1bnRpbWUuSlNfMl8wLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAyLiBDbG91ZEZyb250VG9TMyBzb2x1dGlvbiBjb25zdHJ1Y3Qg4oCUIFMzIGJ1Y2tldCArIENsb3VkRnJvbnQgd2l0aCBPQUNcbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGNsb3VkRnJvbnRUb1MzID0gbmV3IENsb3VkRnJvbnRUb1MzKHRoaXMsICdDbG91ZEZyb250VG9TMycsIHtcbiAgICAgIGluc2VydEh0dHBTZWN1cml0eUhlYWRlcnM6IGZhbHNlLCAvLyBXZSBtYW5hZ2UgaGVhZGVycyB2aWEgb3VyIENTUCBGdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OlxuICAgICAgICAgICAgY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfT1BUSU1JWkVELFxuICAgICAgICAgIGZ1bmN0aW9uQXNzb2NpYXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGZ1bmN0aW9uOiBjc3BGdW5jdGlvbixcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkZ1bmN0aW9uRXZlbnRUeXBlLlZJRVdFUl9SRVNQT05TRSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgfSxcbiAgICAgICAgLy8gU1BBIGVycm9yIHJlc3BvbnNlcyDigJQgcmVkaXJlY3QgNDAzLzQwNCB0byAvaW5kZXguaHRtbCBmb3IgY2xpZW50LXNpZGUgcm91dGluZ1xuICAgICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDQsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICAgIHByaWNlQ2xhc3M6IGNsb3VkZnJvbnQuUHJpY2VDbGFzcy5QUklDRV9DTEFTU18xMDAsXG4gICAgICAgIGh0dHBWZXJzaW9uOiBjbG91ZGZyb250Lkh0dHBWZXJzaW9uLkhUVFAyX0FORF8zLFxuICAgICAgICBtaW5pbXVtUHJvdG9jb2xWZXJzaW9uOlxuICAgICAgICAgIGNsb3VkZnJvbnQuU2VjdXJpdHlQb2xpY3lQcm90b2NvbC5UTFNfVjFfMl8yMDIxLFxuICAgICAgICBlbmFibGVMb2dnaW5nOiBmYWxzZSxcbiAgICAgIH0sXG4gICAgfSk7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDMuIEFkZCAvYXBpLyogYmVoYXZpb3Ig4oCUIHByb3h5IHRvIEFQSSBHYXRld2F5IG9yaWdpblxuICAgIC8vICAgIC0gSFRUUFMgb25seSwgY2FjaGluZyBkaXNhYmxlZCwgYWxsIHZpZXdlciBoZWFkZXJzIGZvcndhcmRlZFxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgYXBpT3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlHYXRld2F5RG9tYWluLCB7XG4gICAgICBwcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgb3JpZ2luUGF0aDogJycsXG4gICAgfSk7XG5cbiAgICBjbG91ZEZyb250VG9TMy5jbG91ZEZyb250V2ViRGlzdHJpYnV0aW9uLmFkZEJlaGF2aW9yKCcvYXBpLyonLCBhcGlPcmlnaW4sIHtcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcbiAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LkhUVFBTX09OTFksXG4gICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX0RJU0FCTEVELFxuICAgICAgb3JpZ2luUmVxdWVzdFBvbGljeTpcbiAgICAgICAgY2xvdWRmcm9udC5PcmlnaW5SZXF1ZXN0UG9saWN5LkFMTF9WSUVXRVJfRVhDRVBUX0hPU1RfSEVBREVSLFxuICAgIH0pO1xuXG4gICAgdGhpcy5kaXN0cmlidXRpb25Eb21haW5OYW1lID1cbiAgICAgIGNsb3VkRnJvbnRUb1MzLmNsb3VkRnJvbnRXZWJEaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNC4gQnVja2V0RGVwbG95bWVudCDigJQgc3luYyBidWlsZCBvdXRwdXQgdG8gUzMgKyBDbG91ZEZyb250IGludmFsaWRhdGlvblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IHMzZGVwbG95LkJ1Y2tldERlcGxveW1lbnQodGhpcywgJ0RlcGxveVdlYnNpdGUnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KGJ1aWxkT3V0cHV0UGF0aCldLFxuICAgICAgZGVzdGluYXRpb25CdWNrZXQ6IGNsb3VkRnJvbnRUb1MzLnMzQnVja2V0SW50ZXJmYWNlIGFzIGNkay5hd3NfczMuSUJ1Y2tldCxcbiAgICAgIGRpc3RyaWJ1dGlvbjogY2xvdWRGcm9udFRvUzMuY2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbixcbiAgICAgIGRpc3RyaWJ1dGlvblBhdGhzOiBbJy8qJ10sXG4gICAgICBwcnVuZTogdHJ1ZSxcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gNS4gU3RhY2sgb3V0cHV0c1xuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Rpc3RyaWJ1dGlvbkRvbWFpbk5hbWUnLCB7XG4gICAgICB2YWx1ZTogdGhpcy5kaXN0cmlidXRpb25Eb21haW5OYW1lLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IERpc3RyaWJ1dGlvbiBEb21haW4gTmFtZScsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tRGlzdHJpYnV0aW9uRG9tYWluTmFtZWAsXG4gICAgfSk7XG5cbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnV2Vic2l0ZVVybCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke3RoaXMuZGlzdHJpYnV0aW9uRG9tYWluTmFtZX1gLFxuICAgICAgZGVzY3JpcHRpb246ICdXZWJzaXRlIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgJHtpZH0tV2Vic2l0ZVVybGAsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==