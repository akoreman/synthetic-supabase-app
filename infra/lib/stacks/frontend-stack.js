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
        const cloudFrontToS3 = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
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
            originRequestPolicy: cloudfront.OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER,
        });
        // ---------------------------------------------------------------------------
        // 5. BucketDeployment — sync build output to S3 + CloudFront invalidation
        // ---------------------------------------------------------------------------
        new s3deploy.BucketDeployment(this, 'DeployWebsite', {
            sources: [s3deploy.Source.asset(buildOutputPath)],
            destinationBucket: cloudFrontToS3.s3BucketInterface,
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
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBUzdFLE1BQWEsYUFBYyxTQUFRLEdBQUcsQ0FBQyxLQUFLO0lBQzFCLHNCQUFzQixDQUFTO0lBRS9DLFlBQVksS0FBZ0IsRUFBRSxFQUFVLEVBQUUsS0FBeUI7UUFDakUsS0FBSyxDQUFDLEtBQUssRUFBRSxFQUFFLEVBQUUsS0FBSyxDQUFDLENBQUM7UUFFeEIsTUFBTSxFQUFFLFdBQVcsRUFBRSxlQUFlLEVBQUUsZ0JBQWdCLEVBQUUsR0FBRyxLQUFLLENBQUM7UUFFakUsOEVBQThFO1FBQzlFLDJFQUEyRTtRQUMzRSw4RUFBOEU7UUFDOUUsTUFBTSxXQUFXLEdBQUcsSUFBSSxVQUFVLENBQUMsUUFBUSxDQUFDLElBQUksRUFBRSxhQUFhLEVBQUU7WUFDL0QsWUFBWSxFQUFFLE9BQU8sV0FBVyxNQUFNO1lBQ3RDLElBQUksRUFBRSxVQUFVLENBQUMsWUFBWSxDQUFDLFVBQVUsQ0FBQzs7Ozs7Ozs7Ozs7Ozs7Ozs7O09Ba0J4QyxDQUFDLElBQUksRUFBRSxDQUFDO1lBQ1QsT0FBTyxFQUFFLFVBQVUsQ0FBQyxlQUFlLENBQUMsTUFBTTtTQUMzQyxDQUFDLENBQUM7UUFFSCw4RUFBOEU7UUFDOUUseUVBQXlFO1FBQ3pFLDhFQUE4RTtRQUM5RSxNQUFNLGNBQWMsR0FBRyxJQUFJLGtDQUFjLENBQUMsSUFBSSxFQUFFLGdCQUFnQixFQUFFO1lBQ2hFLHlCQUF5QixFQUFFLEtBQUssRUFBRSw2Q0FBNkM7WUFDL0UsMkJBQTJCLEVBQUU7Z0JBQzNCLGVBQWUsRUFBRTtvQkFDZix1Q0FBdUM7b0JBQ3ZDLG9CQUFvQixFQUFFO3dCQUNwQjs0QkFDRSxRQUFRLEVBQUUsV0FBVzs0QkFDckIsU0FBUyxFQUFFLFVBQVUsQ0FBQyxpQkFBaUIsQ0FBQyxlQUFlO3lCQUN4RDtxQkFDRjtvQkFDRCxvQkFBb0IsRUFBRSxVQUFVLENBQUMsb0JBQW9CLENBQUMsaUJBQWlCO29CQUN2RSxXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxpQkFBaUI7b0JBQ3JELGNBQWMsRUFBRSxVQUFVLENBQUMsY0FBYyxDQUFDLHNCQUFzQjtpQkFDakU7Z0JBQ0QsZ0VBQWdFO2dCQUNoRSxjQUFjLEVBQUU7b0JBQ2Q7d0JBQ0UsVUFBVSxFQUFFLEdBQUc7d0JBQ2Ysa0JBQWtCLEVBQUUsR0FBRzt3QkFDdkIsZ0JBQWdCLEVBQUUsYUFBYTt3QkFDL0IsR0FBRyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztxQkFDN0I7b0JBQ0Q7d0JBQ0UsVUFBVSxFQUFFLEdBQUc7d0JBQ2Ysa0JBQWtCLEVBQUUsR0FBRzt3QkFDdkIsZ0JBQWdCLEVBQUUsYUFBYTt3QkFDL0IsR0FBRyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztxQkFDN0I7aUJBQ0Y7Z0JBQ0QsNkNBQTZDO2dCQUM3QyxVQUFVLEVBQUUsVUFBVSxDQUFDLFVBQVUsQ0FBQyxlQUFlO2dCQUNqRCxXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxXQUFXO2dCQUMvQyxzQkFBc0IsRUFBRSxVQUFVLENBQUMsc0JBQXNCLENBQUMsYUFBYTtnQkFDdkUsT0FBTyxFQUFFLE9BQU8sV0FBVyx3QkFBd0I7YUFDcEQ7U0FDRixDQUFDLENBQUM7UUFFSCxNQUFNLFlBQVksR0FBRyxjQUFjLENBQUMseUJBQXlCLENBQUM7UUFFOUQsOEVBQThFO1FBQzlFLDRFQUE0RTtRQUM1RSw4RUFBOEU7UUFDOUUsTUFBTSxTQUFTLEdBQUcsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFO1lBQ3pELGNBQWMsRUFBRSxVQUFVLENBQUMsb0JBQW9CLENBQUMsVUFBVTtZQUMxRCxVQUFVLEVBQUUsRUFBRTtTQUNmLENBQUMsQ0FBQztRQUVILFlBQVksQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRTtZQUM1QyxjQUFjLEVBQUUsVUFBVSxDQUFDLGNBQWMsQ0FBQyxTQUFTO1lBQ25ELG9CQUFvQixFQUFFLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxpQkFBaUI7WUFDdkUsV0FBVyxFQUFFLFVBQVUsQ0FBQyxXQUFXLENBQUMsZ0JBQWdCO1lBQ3BELG1CQUFtQixFQUNqQixVQUFVLENBQUMsbUJBQW1CLENBQUMsNkJBQTZCO1NBQy9ELENBQUMsQ0FBQztRQUVILDhFQUE4RTtRQUM5RSwwRUFBMEU7UUFDMUUsOEVBQThFO1FBQzlFLElBQUksUUFBUSxDQUFDLGdCQUFnQixDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDbkQsT0FBTyxFQUFFLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsZUFBZSxDQUFDLENBQUM7WUFDakQsaUJBQWlCLEVBQUUsY0FBYyxDQUFDLGlCQUF1QztZQUN6RSxZQUFZO1lBQ1osaUJBQWlCLEVBQUUsQ0FBQyxJQUFJLENBQUM7WUFDekIsV0FBVyxFQUFFLEdBQUc7U0FDakIsQ0FBQyxDQUFDO1FBRUgsSUFBSSxDQUFDLHNCQUFzQixHQUFHLFlBQVksQ0FBQyxzQkFBc0IsQ0FBQztRQUVsRSxVQUFVO1FBQ1YsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSxlQUFlLEVBQUU7WUFDdkMsS0FBSyxFQUFFLFdBQVcsWUFBWSxDQUFDLHNCQUFzQixFQUFFO1lBQ3ZELFdBQVcsRUFBRSw2QkFBNkI7WUFDMUMsVUFBVSxFQUFFLE9BQU8sV0FBVyxnQkFBZ0I7U0FDL0MsQ0FBQyxDQUFDO1FBRUgsSUFBSSxHQUFHLENBQUMsU0FBUyxDQUFDLElBQUksRUFBRSwwQkFBMEIsRUFBRTtZQUNsRCxLQUFLLEVBQUUsWUFBWSxDQUFDLGNBQWM7WUFDbEMsV0FBVyxFQUFFLDRCQUE0QjtZQUN6QyxVQUFVLEVBQUUsT0FBTyxXQUFXLDJCQUEyQjtTQUMxRCxDQUFDLENBQUM7SUFDTCxDQUFDO0NBQ0Y7QUF4SEQsc0NBd0hDIiwic291cmNlc0NvbnRlbnQiOlsiaW1wb3J0ICogYXMgY2RrIGZyb20gJ2F3cy1jZGstbGliJztcbmltcG9ydCAqIGFzIGNsb3VkZnJvbnQgZnJvbSAnYXdzLWNkay1saWIvYXdzLWNsb3VkZnJvbnQnO1xuaW1wb3J0ICogYXMgb3JpZ2lucyBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udC1vcmlnaW5zJztcbmltcG9ydCAqIGFzIHMzZGVwbG95IGZyb20gJ2F3cy1jZGstbGliL2F3cy1zMy1kZXBsb3ltZW50JztcbmltcG9ydCB7IENsb3VkRnJvbnRUb1MzIH0gZnJvbSAnQGF3cy1zb2x1dGlvbnMtY29uc3RydWN0cy9hd3MtY2xvdWRmcm9udC1zMyc7XG5pbXBvcnQgeyBDb25zdHJ1Y3QgfSBmcm9tICdjb25zdHJ1Y3RzJztcblxuZXhwb3J0IGludGVyZmFjZSBGcm9udGVuZFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG4gIGJ1aWxkT3V0cHV0UGF0aDogc3RyaW5nOyAvLyBlLmcuIFwiLi4vZGlzdFwiXG4gIGFwaUdhdGV3YXlEb21haW46IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEZyb250ZW5kU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZGlzdHJpYnV0aW9uRG9tYWluTmFtZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBGcm9udGVuZFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGJ1aWxkT3V0cHV0UGF0aCwgYXBpR2F0ZXdheURvbWFpbiB9ID0gcHJvcHM7XG5cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICAvLyAzLiBDU1AgQ2xvdWRGcm9udCBGdW5jdGlvbiDigJQgcGVybWlzc2l2ZSBwb2xpY3kgZm9yIHRoaXJkLXBhcnR5IENETnMvQVBJc1xuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGNzcEZ1bmN0aW9uID0gbmV3IGNsb3VkZnJvbnQuRnVuY3Rpb24odGhpcywgJ0NzcEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgQXBwLSR7ZW52aXJvbm1lbnR9LWNzcGAsXG4gICAgICBjb2RlOiBjbG91ZGZyb250LkZ1bmN0aW9uQ29kZS5mcm9tSW5saW5lKGBcbmZ1bmN0aW9uIGhhbmRsZXIoZXZlbnQpIHtcbiAgdmFyIHJlc3BvbnNlID0gZXZlbnQucmVzcG9uc2U7XG4gIHZhciBoZWFkZXJzID0gcmVzcG9uc2UuaGVhZGVycztcbiAgaGVhZGVyc1snY29udGVudC1zZWN1cml0eS1wb2xpY3knXSA9IHtcbiAgICB2YWx1ZTogXCJkZWZhdWx0LXNyYyAnc2VsZic7IFwiICtcbiAgICAgICAgICAgXCJzY3JpcHQtc3JjICdzZWxmJyAndW5zYWZlLWlubGluZScgJ3Vuc2FmZS1ldmFsJyBodHRwczo7IFwiICtcbiAgICAgICAgICAgXCJzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyBodHRwczo7IFwiICtcbiAgICAgICAgICAgXCJpbWctc3JjICdzZWxmJyBkYXRhOiBodHRwczo7IFwiICtcbiAgICAgICAgICAgXCJmb250LXNyYyAnc2VsZicgZGF0YTogaHR0cHM6OyBcIiArXG4gICAgICAgICAgIFwiY29ubmVjdC1zcmMgJ3NlbGYnIGh0dHBzOjsgXCIgK1xuICAgICAgICAgICBcImZyYW1lLXNyYyAnc2VsZicgaHR0cHM6O1wiXG4gIH07XG4gIGhlYWRlcnNbJ3gtY29udGVudC10eXBlLW9wdGlvbnMnXSA9IHsgdmFsdWU6ICdub3NuaWZmJyB9O1xuICBoZWFkZXJzWyd4LWZyYW1lLW9wdGlvbnMnXSA9IHsgdmFsdWU6ICdTQU1FT1JJR0lOJyB9O1xuICBoZWFkZXJzWyd4LXhzcy1wcm90ZWN0aW9uJ10gPSB7IHZhbHVlOiAnMTsgbW9kZT1ibG9jaycgfTtcbiAgcmV0dXJuIHJlc3BvbnNlO1xufVxuICAgICAgYC50cmltKCkpLFxuICAgICAgcnVudGltZTogY2xvdWRmcm9udC5GdW5jdGlvblJ1bnRpbWUuSlNfMl8wLFxuICAgIH0pO1xuXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgLy8gMS4gQ2xvdWRGcm9udFRvUzMgc29sdXRpb24gY29uc3RydWN0IOKAlCBTMyBidWNrZXQgKyBDbG91ZEZyb250IHdpdGggT0FDXG4gICAgLy8gLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tXG4gICAgY29uc3QgY2xvdWRGcm9udFRvUzMgPSBuZXcgQ2xvdWRGcm9udFRvUzModGhpcywgJ0Nsb3VkRnJvbnRUb1MzJywge1xuICAgICAgaW5zZXJ0SHR0cFNlY3VyaXR5SGVhZGVyczogZmFsc2UsIC8vIHdlIGhhbmRsZSBoZWFkZXJzIHZpYSBvdXIgb3duIENTUCBmdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRCZWhhdmlvcjoge1xuICAgICAgICAgIC8vIENTUCBmdW5jdGlvbiBydW5zIG9uIHZpZXdlci1yZXNwb25zZVxuICAgICAgICAgIGZ1bmN0aW9uQXNzb2NpYXRpb25zOiBbXG4gICAgICAgICAgICB7XG4gICAgICAgICAgICAgIGZ1bmN0aW9uOiBjc3BGdW5jdGlvbixcbiAgICAgICAgICAgICAgZXZlbnRUeXBlOiBjbG91ZGZyb250LkZ1bmN0aW9uRXZlbnRUeXBlLlZJRVdFUl9SRVNQT05TRSxcbiAgICAgICAgICAgIH0sXG4gICAgICAgICAgXSxcbiAgICAgICAgICB2aWV3ZXJQcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5WaWV3ZXJQcm90b2NvbFBvbGljeS5SRURJUkVDVF9UT19IVFRQUyxcbiAgICAgICAgICBjYWNoZVBvbGljeTogY2xvdWRmcm9udC5DYWNoZVBvbGljeS5DQUNISU5HX09QVElNSVpFRCxcbiAgICAgICAgICBhbGxvd2VkTWV0aG9kczogY2xvdWRmcm9udC5BbGxvd2VkTWV0aG9kcy5BTExPV19HRVRfSEVBRF9PUFRJT05TLFxuICAgICAgICB9LFxuICAgICAgICAvLyAyLiBTUEEgZXJyb3IgcmVzcG9uc2VzOiA0MDMvNDA0IOKGkiAvaW5kZXguaHRtbCB3aXRoIDIwMCBzdGF0dXNcbiAgICAgICAgZXJyb3JSZXNwb25zZXM6IFtcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDMsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAgIH0sXG4gICAgICAgICAge1xuICAgICAgICAgICAgaHR0cFN0YXR1czogNDA0LFxuICAgICAgICAgICAgcmVzcG9uc2VIdHRwU3RhdHVzOiAyMDAsXG4gICAgICAgICAgICByZXNwb25zZVBhZ2VQYXRoOiAnL2luZGV4Lmh0bWwnLFxuICAgICAgICAgICAgdHRsOiBjZGsuRHVyYXRpb24uc2Vjb25kcygwKSxcbiAgICAgICAgICB9LFxuICAgICAgICBdLFxuICAgICAgICAvLyA2LiBQcmljZSBjbGFzcywgSFRUUCB2ZXJzaW9ucywgVExTIG1pbmltdW1cbiAgICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTXzEwMCxcbiAgICAgICAgaHR0cFZlcnNpb246IGNsb3VkZnJvbnQuSHR0cFZlcnNpb24uSFRUUDJfQU5EXzMsXG4gICAgICAgIG1pbmltdW1Qcm90b2NvbFZlcnNpb246IGNsb3VkZnJvbnQuU2VjdXJpdHlQb2xpY3lQcm90b2NvbC5UTFNfVjFfMl8yMDIxLFxuICAgICAgICBjb21tZW50OiBgQXBwLSR7ZW52aXJvbm1lbnR9IGZyb250ZW5kIGRpc3RyaWJ1dGlvbmAsXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uID0gY2xvdWRGcm9udFRvUzMuY2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbjtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDQuIC9hcGkvKiBiZWhhdmlvciDigJQgcHJveHkgdG8gQVBJIEdhdGV3YXkgb3JpZ2luIChIVFRQUyBvbmx5LCBubyBjYWNoaW5nKVxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIGNvbnN0IGFwaU9yaWdpbiA9IG5ldyBvcmlnaW5zLkh0dHBPcmlnaW4oYXBpR2F0ZXdheURvbWFpbiwge1xuICAgICAgcHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuT3JpZ2luUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgICAgIG9yaWdpblBhdGg6ICcnLFxuICAgIH0pO1xuXG4gICAgZGlzdHJpYnV0aW9uLmFkZEJlaGF2aW9yKCcvYXBpLyonLCBhcGlPcmlnaW4sIHtcbiAgICAgIGFsbG93ZWRNZXRob2RzOiBjbG91ZGZyb250LkFsbG93ZWRNZXRob2RzLkFMTE9XX0FMTCxcbiAgICAgIHZpZXdlclByb3RvY29sUG9saWN5OiBjbG91ZGZyb250LlZpZXdlclByb3RvY29sUG9saWN5LlJFRElSRUNUX1RPX0hUVFBTLFxuICAgICAgY2FjaGVQb2xpY3k6IGNsb3VkZnJvbnQuQ2FjaGVQb2xpY3kuQ0FDSElOR19ESVNBQkxFRCxcbiAgICAgIG9yaWdpblJlcXVlc3RQb2xpY3k6XG4gICAgICAgIGNsb3VkZnJvbnQuT3JpZ2luUmVxdWVzdFBvbGljeS5BTExfVklFV0VSX0VYQ0VQVF9IT1NUX0hFQURFUixcbiAgICB9KTtcblxuICAgIC8vIC0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLVxuICAgIC8vIDUuIEJ1Y2tldERlcGxveW1lbnQg4oCUIHN5bmMgYnVpbGQgb3V0cHV0IHRvIFMzICsgQ2xvdWRGcm9udCBpbnZhbGlkYXRpb25cbiAgICAvLyAtLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS0tLS1cbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95V2Vic2l0ZScsIHtcbiAgICAgIHNvdXJjZXM6IFtzM2RlcGxveS5Tb3VyY2UuYXNzZXQoYnVpbGRPdXRwdXRQYXRoKV0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogY2xvdWRGcm9udFRvUzMuczNCdWNrZXRJbnRlcmZhY2UgYXMgY2RrLmF3c19zMy5JQnVja2V0LFxuICAgICAgZGlzdHJpYnV0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uUGF0aHM6IFsnLyonXSxcbiAgICAgIG1lbW9yeUxpbWl0OiA1MTIsXG4gICAgfSk7XG5cbiAgICB0aGlzLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWUgPSBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZTtcblxuICAgIC8vIE91dHB1dHNcbiAgICBuZXcgY2RrLkNmbk91dHB1dCh0aGlzLCAnQ2xvdWRGcm9udFVSTCcsIHtcbiAgICAgIHZhbHVlOiBgaHR0cHM6Ly8ke2Rpc3RyaWJ1dGlvbi5kaXN0cmlidXRpb25Eb21haW5OYW1lfWAsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIFVSTCcsXG4gICAgICBleHBvcnROYW1lOiBgQXBwLSR7ZW52aXJvbm1lbnR9LUNsb3VkRnJvbnRVUkxgLFxuICAgIH0pO1xuXG4gICAgbmV3IGNkay5DZm5PdXRwdXQodGhpcywgJ0Nsb3VkRnJvbnREaXN0cmlidXRpb25JZCcsIHtcbiAgICAgIHZhbHVlOiBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uSWQsXG4gICAgICBkZXNjcmlwdGlvbjogJ0Nsb3VkRnJvbnQgZGlzdHJpYnV0aW9uIElEJyxcbiAgICAgIGV4cG9ydE5hbWU6IGBBcHAtJHtlbnZpcm9ubWVudH0tQ2xvdWRGcm9udERpc3RyaWJ1dGlvbklkYCxcbiAgICB9KTtcbiAgfVxufVxuIl19