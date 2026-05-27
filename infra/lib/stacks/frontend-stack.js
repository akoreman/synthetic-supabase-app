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
const path = __importStar(require("path"));
class FrontendStack extends cdk.Stack {
    distributionDomainName;
    constructor(scope, id, props) {
        super(scope, id, props);
        const { environment, buildOutputPath, apiGatewayDomain } = props;
        // ── 1. CloudFrontToS3 solution construct ────────────────────────────────
        // Creates the S3 bucket (private, OAC-protected) and a CloudFront distribution.
        const cloudFrontToS3 = new aws_cloudfront_s3_1.CloudFrontToS3(this, 'CloudFrontToS3', {
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
        const cfnDistribution = distribution.node.defaultChild;
        cfnDistribution.addPropertyOverride('DistributionConfig.DefaultCacheBehavior.FunctionAssociations', [
            {
                EventType: 'viewer-response',
                FunctionARN: cspFunction.functionArn,
            },
        ]);
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
            destinationBucket: cloudFrontToS3.s3BucketInterface,
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
exports.FrontendStack = FrontendStack;
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJmaWxlIjoiZnJvbnRlbmQtc3RhY2suanMiLCJzb3VyY2VSb290IjoiIiwic291cmNlcyI6WyJmcm9udGVuZC1zdGFjay50cyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiOzs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7QUFBQSxpREFBbUM7QUFDbkMsdUVBQXlEO0FBQ3pELDRFQUE4RDtBQUM5RCx3RUFBMEQ7QUFDMUQsbUZBQTZFO0FBRTdFLDJDQUE2QjtBQVE3QixNQUFhLGFBQWMsU0FBUSxHQUFHLENBQUMsS0FBSztJQUMxQixzQkFBc0IsQ0FBUztJQUUvQyxZQUFZLEtBQWdCLEVBQUUsRUFBVSxFQUFFLEtBQXlCO1FBQ2pFLEtBQUssQ0FBQyxLQUFLLEVBQUUsRUFBRSxFQUFFLEtBQUssQ0FBQyxDQUFDO1FBRXhCLE1BQU0sRUFBRSxXQUFXLEVBQUUsZUFBZSxFQUFFLGdCQUFnQixFQUFFLEdBQUcsS0FBSyxDQUFDO1FBRWpFLDJFQUEyRTtRQUMzRSxnRkFBZ0Y7UUFDaEYsTUFBTSxjQUFjLEdBQUcsSUFBSSxrQ0FBYyxDQUFDLElBQUksRUFBRSxnQkFBZ0IsRUFBRTtZQUNoRSx5QkFBeUIsRUFBRSxLQUFLLEVBQUUsMENBQTBDO1lBQzVFLDJCQUEyQixFQUFFO2dCQUMzQixpQkFBaUIsRUFBRSxZQUFZO2dCQUMvQixXQUFXLEVBQUUsVUFBVSxDQUFDLFdBQVcsQ0FBQyxXQUFXO2dCQUMvQyxzQkFBc0IsRUFBRSxVQUFVLENBQUMsc0JBQXNCLENBQUMsYUFBYTtnQkFDdkUsVUFBVSxFQUFFLFVBQVUsQ0FBQyxVQUFVLENBQUMsZUFBZTtnQkFFakQsdUVBQXVFO2dCQUN2RSxjQUFjLEVBQUU7b0JBQ2Q7d0JBQ0UsVUFBVSxFQUFFLEdBQUc7d0JBQ2Ysa0JBQWtCLEVBQUUsR0FBRzt3QkFDdkIsZ0JBQWdCLEVBQUUsYUFBYTt3QkFDL0IsR0FBRyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztxQkFDN0I7b0JBQ0Q7d0JBQ0UsVUFBVSxFQUFFLEdBQUc7d0JBQ2Ysa0JBQWtCLEVBQUUsR0FBRzt3QkFDdkIsZ0JBQWdCLEVBQUUsYUFBYTt3QkFDL0IsR0FBRyxFQUFFLEdBQUcsQ0FBQyxRQUFRLENBQUMsT0FBTyxDQUFDLENBQUMsQ0FBQztxQkFDN0I7aUJBQ0Y7YUFDRjtTQUNGLENBQUMsQ0FBQztRQUVILE1BQU0sWUFBWSxHQUFHLGNBQWMsQ0FBQyx5QkFBeUIsQ0FBQztRQUU5RCw0RUFBNEU7UUFDNUUsdUVBQXVFO1FBQ3ZFLE1BQU0sV0FBVyxHQUFHLElBQUksVUFBVSxDQUFDLFFBQVEsQ0FBQyxJQUFJLEVBQUUsYUFBYSxFQUFFO1lBQy9ELFlBQVksRUFBRSxlQUFlLFdBQVcsRUFBRTtZQUMxQyxJQUFJLEVBQUUsVUFBVSxDQUFDLFlBQVksQ0FBQyxVQUFVLENBQUM7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7T0F5QnhDLENBQUMsSUFBSSxFQUFFLENBQUM7WUFDVCxPQUFPLEVBQUUsVUFBVSxDQUFDLGVBQWUsQ0FBQyxNQUFNO1lBQzFDLE9BQU8sRUFBRSwyREFBMkQ7U0FDckUsQ0FBQyxDQUFDO1FBRUgsb0ZBQW9GO1FBQ3BGLDhFQUE4RTtRQUM5RSxNQUFNLGVBQWUsR0FBRyxZQUFZLENBQUMsSUFBSSxDQUFDLFlBQTBDLENBQUM7UUFDckYsZUFBZSxDQUFDLG1CQUFtQixDQUNqQyw4REFBOEQsRUFDOUQ7WUFDRTtnQkFDRSxTQUFTLEVBQUUsaUJBQWlCO2dCQUM1QixXQUFXLEVBQUUsV0FBVyxDQUFDLFdBQVc7YUFDckM7U0FDRixDQUNGLENBQUM7UUFFRiw0RUFBNEU7UUFDNUUsTUFBTSxTQUFTLEdBQUcsSUFBSSxPQUFPLENBQUMsVUFBVSxDQUFDLGdCQUFnQixFQUFFO1lBQ3pELGNBQWMsRUFBRSxVQUFVLENBQUMsb0JBQW9CLENBQUMsVUFBVTtZQUMxRCxVQUFVLEVBQUUsRUFBRTtTQUNmLENBQUMsQ0FBQztRQUVILFlBQVksQ0FBQyxXQUFXLENBQUMsUUFBUSxFQUFFLFNBQVMsRUFBRTtZQUM1QyxjQUFjLEVBQUUsVUFBVSxDQUFDLGNBQWMsQ0FBQyxTQUFTO1lBQ25ELG9CQUFvQixFQUFFLFVBQVUsQ0FBQyxvQkFBb0IsQ0FBQyxVQUFVO1lBQ2hFLFdBQVcsRUFBRSxVQUFVLENBQUMsV0FBVyxDQUFDLGdCQUFnQjtZQUNwRCxtQkFBbUIsRUFBRSxVQUFVLENBQUMsbUJBQW1CLENBQUMsNkJBQTZCO1NBQ2xGLENBQUMsQ0FBQztRQUVILDRFQUE0RTtRQUM1RSxxRUFBcUU7UUFDckUsTUFBTSxpQkFBaUIsR0FBRyxJQUFJLENBQUMsVUFBVSxDQUFDLGVBQWUsQ0FBQztZQUN4RCxDQUFDLENBQUMsZUFBZTtZQUNqQixDQUFDLENBQUMsSUFBSSxDQUFDLElBQUksQ0FBQyxTQUFTLEVBQUUsSUFBSSxFQUFFLElBQUksRUFBRSxJQUFJLEVBQUUsZUFBZSxDQUFDLE9BQU8sQ0FBQyxTQUFTLEVBQUUsRUFBRSxDQUFDLENBQUMsQ0FBQztRQUVuRixJQUFJLFFBQVEsQ0FBQyxnQkFBZ0IsQ0FBQyxJQUFJLEVBQUUsZ0JBQWdCLEVBQUU7WUFDcEQsT0FBTyxFQUFFLENBQUMsUUFBUSxDQUFDLE1BQU0sQ0FBQyxLQUFLLENBQUMsaUJBQWlCLENBQUMsQ0FBQztZQUNuRCxpQkFBaUIsRUFBRSxjQUFjLENBQUMsaUJBQXVDO1lBQ3pFLFlBQVk7WUFDWixpQkFBaUIsRUFBRSxDQUFDLElBQUksQ0FBQztZQUN6QixXQUFXLEVBQUUsR0FBRztTQUNqQixDQUFDLENBQUM7UUFFSCxJQUFJLENBQUMsc0JBQXNCLEdBQUcsWUFBWSxDQUFDLHNCQUFzQixDQUFDO1FBRWxFLDRFQUE0RTtRQUM1RSxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLGVBQWUsRUFBRTtZQUN2QyxLQUFLLEVBQUUsV0FBVyxZQUFZLENBQUMsc0JBQXNCLEVBQUU7WUFDdkQsV0FBVyxFQUFFLDZCQUE2QjtTQUMzQyxDQUFDLENBQUM7UUFFSCxJQUFJLEdBQUcsQ0FBQyxTQUFTLENBQUMsSUFBSSxFQUFFLDBCQUEwQixFQUFFO1lBQ2xELEtBQUssRUFBRSxZQUFZLENBQUMsY0FBYztZQUNsQyxXQUFXLEVBQUUsNEJBQTRCO1NBQzFDLENBQUMsQ0FBQztJQUNMLENBQUM7Q0FDRjtBQTdIRCxzQ0E2SEMiLCJzb3VyY2VzQ29udGVudCI6WyJpbXBvcnQgKiBhcyBjZGsgZnJvbSAnYXdzLWNkay1saWInO1xuaW1wb3J0ICogYXMgY2xvdWRmcm9udCBmcm9tICdhd3MtY2RrLWxpYi9hd3MtY2xvdWRmcm9udCc7XG5pbXBvcnQgKiBhcyBvcmlnaW5zIGZyb20gJ2F3cy1jZGstbGliL2F3cy1jbG91ZGZyb250LW9yaWdpbnMnO1xuaW1wb3J0ICogYXMgczNkZXBsb3kgZnJvbSAnYXdzLWNkay1saWIvYXdzLXMzLWRlcGxveW1lbnQnO1xuaW1wb3J0IHsgQ2xvdWRGcm9udFRvUzMgfSBmcm9tICdAYXdzLXNvbHV0aW9ucy1jb25zdHJ1Y3RzL2F3cy1jbG91ZGZyb250LXMzJztcbmltcG9ydCB7IENvbnN0cnVjdCB9IGZyb20gJ2NvbnN0cnVjdHMnO1xuaW1wb3J0ICogYXMgcGF0aCBmcm9tICdwYXRoJztcblxuZXhwb3J0IGludGVyZmFjZSBGcm9udGVuZFN0YWNrUHJvcHMgZXh0ZW5kcyBjZGsuU3RhY2tQcm9wcyB7XG4gIGVudmlyb25tZW50OiBzdHJpbmc7XG4gIGJ1aWxkT3V0cHV0UGF0aDogc3RyaW5nOyAvLyBlLmcuIFwiLi4vZGlzdFwiXG4gIGFwaUdhdGV3YXlEb21haW46IHN0cmluZztcbn1cblxuZXhwb3J0IGNsYXNzIEZyb250ZW5kU3RhY2sgZXh0ZW5kcyBjZGsuU3RhY2sge1xuICBwdWJsaWMgcmVhZG9ubHkgZGlzdHJpYnV0aW9uRG9tYWluTmFtZTogc3RyaW5nO1xuXG4gIGNvbnN0cnVjdG9yKHNjb3BlOiBDb25zdHJ1Y3QsIGlkOiBzdHJpbmcsIHByb3BzOiBGcm9udGVuZFN0YWNrUHJvcHMpIHtcbiAgICBzdXBlcihzY29wZSwgaWQsIHByb3BzKTtcblxuICAgIGNvbnN0IHsgZW52aXJvbm1lbnQsIGJ1aWxkT3V0cHV0UGF0aCwgYXBpR2F0ZXdheURvbWFpbiB9ID0gcHJvcHM7XG5cbiAgICAvLyDilIDilIAgMS4gQ2xvdWRGcm9udFRvUzMgc29sdXRpb24gY29uc3RydWN0IOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIC8vIENyZWF0ZXMgdGhlIFMzIGJ1Y2tldCAocHJpdmF0ZSwgT0FDLXByb3RlY3RlZCkgYW5kIGEgQ2xvdWRGcm9udCBkaXN0cmlidXRpb24uXG4gICAgY29uc3QgY2xvdWRGcm9udFRvUzMgPSBuZXcgQ2xvdWRGcm9udFRvUzModGhpcywgJ0Nsb3VkRnJvbnRUb1MzJywge1xuICAgICAgaW5zZXJ0SHR0cFNlY3VyaXR5SGVhZGVyczogZmFsc2UsIC8vIHdlIG1hbmFnZSBDU1Agb3Vyc2VsdmVzIHZpYSBDRiBGdW5jdGlvblxuICAgICAgY2xvdWRGcm9udERpc3RyaWJ1dGlvblByb3BzOiB7XG4gICAgICAgIGRlZmF1bHRSb290T2JqZWN0OiAnaW5kZXguaHRtbCcsXG4gICAgICAgIGh0dHBWZXJzaW9uOiBjbG91ZGZyb250Lkh0dHBWZXJzaW9uLkhUVFAyX0FORF8zLFxuICAgICAgICBtaW5pbXVtUHJvdG9jb2xWZXJzaW9uOiBjbG91ZGZyb250LlNlY3VyaXR5UG9saWN5UHJvdG9jb2wuVExTX1YxXzJfMjAyMSxcbiAgICAgICAgcHJpY2VDbGFzczogY2xvdWRmcm9udC5QcmljZUNsYXNzLlBSSUNFX0NMQVNTXzEwMCxcblxuICAgICAgICAvLyDilIDilIAgMi4gU1BBIGVycm9yIHJlc3BvbnNlcyAoNDAzLzQwNCDihpIgL2luZGV4Lmh0bWwpIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgICAgICBlcnJvclJlc3BvbnNlczogW1xuICAgICAgICAgIHtcbiAgICAgICAgICAgIGh0dHBTdGF0dXM6IDQwMyxcbiAgICAgICAgICAgIHJlc3BvbnNlSHR0cFN0YXR1czogMjAwLFxuICAgICAgICAgICAgcmVzcG9uc2VQYWdlUGF0aDogJy9pbmRleC5odG1sJyxcbiAgICAgICAgICAgIHR0bDogY2RrLkR1cmF0aW9uLnNlY29uZHMoMCksXG4gICAgICAgICAgfSxcbiAgICAgICAgICB7XG4gICAgICAgICAgICBodHRwU3RhdHVzOiA0MDQsXG4gICAgICAgICAgICByZXNwb25zZUh0dHBTdGF0dXM6IDIwMCxcbiAgICAgICAgICAgIHJlc3BvbnNlUGFnZVBhdGg6ICcvaW5kZXguaHRtbCcsXG4gICAgICAgICAgICB0dGw6IGNkay5EdXJhdGlvbi5zZWNvbmRzKDApLFxuICAgICAgICAgIH0sXG4gICAgICAgIF0sXG4gICAgICB9LFxuICAgIH0pO1xuXG4gICAgY29uc3QgZGlzdHJpYnV0aW9uID0gY2xvdWRGcm9udFRvUzMuY2xvdWRGcm9udFdlYkRpc3RyaWJ1dGlvbjtcblxuICAgIC8vIOKUgOKUgCAzLiBDU1AgQ2xvdWRGcm9udCBGdW5jdGlvbiDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBQZXJtaXNzaXZlIHBvbGljeSB0aGF0IGFsbG93cyB0aGlyZC1wYXJ0eSBDRE5zL0FQSXMgKFN1cGFiYXNlLCBldGMuKVxuICAgIGNvbnN0IGNzcEZ1bmN0aW9uID0gbmV3IGNsb3VkZnJvbnQuRnVuY3Rpb24odGhpcywgJ0NzcEZ1bmN0aW9uJywge1xuICAgICAgZnVuY3Rpb25OYW1lOiBgY3NwLWhlYWRlcnMtJHtlbnZpcm9ubWVudH1gLFxuICAgICAgY29kZTogY2xvdWRmcm9udC5GdW5jdGlvbkNvZGUuZnJvbUlubGluZShgXG5mdW5jdGlvbiBoYW5kbGVyKGV2ZW50KSB7XG4gIHZhciByZXNwb25zZSA9IGV2ZW50LnJlc3BvbnNlO1xuICB2YXIgaGVhZGVycyA9IHJlc3BvbnNlLmhlYWRlcnM7XG4gIGhlYWRlcnNbJ2NvbnRlbnQtc2VjdXJpdHktcG9saWN5J10gPSB7XG4gICAgdmFsdWU6IFtcbiAgICAgIFwiZGVmYXVsdC1zcmMgJ3NlbGYnXCIsXG4gICAgICBcInNjcmlwdC1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyAndW5zYWZlLWV2YWwnIGh0dHBzOlwiLFxuICAgICAgXCJzdHlsZS1zcmMgJ3NlbGYnICd1bnNhZmUtaW5saW5lJyBodHRwczpcIixcbiAgICAgIFwiaW1nLXNyYyAnc2VsZicgZGF0YTogYmxvYjogaHR0cHM6XCIsXG4gICAgICBcImZvbnQtc3JjICdzZWxmJyBkYXRhOiBodHRwczpcIixcbiAgICAgIFwiY29ubmVjdC1zcmMgJ3NlbGYnIGh0dHBzOiB3c3M6XCIsXG4gICAgICBcIm1lZGlhLXNyYyAnc2VsZicgaHR0cHM6XCIsXG4gICAgICBcImZyYW1lLXNyYyAnc2VsZicgaHR0cHM6XCIsXG4gICAgICBcIm9iamVjdC1zcmMgJ25vbmUnXCIsXG4gICAgICBcImJhc2UtdXJpICdzZWxmJ1wiLFxuICAgICAgXCJmb3JtLWFjdGlvbiAnc2VsZicgaHR0cHM6XCJcbiAgICBdLmpvaW4oJzsgJylcbiAgfTtcbiAgaGVhZGVyc1sneC1jb250ZW50LXR5cGUtb3B0aW9ucyddID0geyB2YWx1ZTogJ25vc25pZmYnIH07XG4gIGhlYWRlcnNbJ3gtZnJhbWUtb3B0aW9ucyddID0geyB2YWx1ZTogJ1NBTUVPUklHSU4nIH07XG4gIGhlYWRlcnNbJ3gteHNzLXByb3RlY3Rpb24nXSA9IHsgdmFsdWU6ICcxOyBtb2RlPWJsb2NrJyB9O1xuICBoZWFkZXJzWydyZWZlcnJlci1wb2xpY3knXSA9IHsgdmFsdWU6ICdzdHJpY3Qtb3JpZ2luLXdoZW4tY3Jvc3Mtb3JpZ2luJyB9O1xuICByZXR1cm4gcmVzcG9uc2U7XG59XG4gICAgICBgLnRyaW0oKSksXG4gICAgICBydW50aW1lOiBjbG91ZGZyb250LkZ1bmN0aW9uUnVudGltZS5KU18yXzAsXG4gICAgICBjb21tZW50OiAnQWRkcyBwZXJtaXNzaXZlIENTUCBhbmQgc2VjdXJpdHkgaGVhZGVycyB0byBhbGwgcmVzcG9uc2VzJyxcbiAgICB9KTtcblxuICAgIC8vIEF0dGFjaCB0aGUgQ1NQIGZ1bmN0aW9uIHRvIHRoZSBkZWZhdWx0ICgqKSBiZWhhdmlvciBhcyBhIHZpZXdlci1yZXNwb25zZSBoYW5kbGVyLlxuICAgIC8vIENsb3VkRnJvbnRUb1MzIGV4cG9zZXMgdGhlIENmbkRpc3RyaWJ1dGlvbiBzbyB3ZSBwYXRjaCBpdCB2aWEgZXNjYXBlIGhhdGNoLlxuICAgIGNvbnN0IGNmbkRpc3RyaWJ1dGlvbiA9IGRpc3RyaWJ1dGlvbi5ub2RlLmRlZmF1bHRDaGlsZCBhcyBjbG91ZGZyb250LkNmbkRpc3RyaWJ1dGlvbjtcbiAgICBjZm5EaXN0cmlidXRpb24uYWRkUHJvcGVydHlPdmVycmlkZShcbiAgICAgICdEaXN0cmlidXRpb25Db25maWcuRGVmYXVsdENhY2hlQmVoYXZpb3IuRnVuY3Rpb25Bc3NvY2lhdGlvbnMnLFxuICAgICAgW1xuICAgICAgICB7XG4gICAgICAgICAgRXZlbnRUeXBlOiAndmlld2VyLXJlc3BvbnNlJyxcbiAgICAgICAgICBGdW5jdGlvbkFSTjogY3NwRnVuY3Rpb24uZnVuY3Rpb25Bcm4sXG4gICAgICAgIH0sXG4gICAgICBdLFxuICAgICk7XG5cbiAgICAvLyDilIDilIAgNC4gL2FwaS8qIGJlaGF2aW9yIOKGkiBBUEkgR2F0ZXdheSBvcmlnaW4g4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSA4pSAXG4gICAgY29uc3QgYXBpT3JpZ2luID0gbmV3IG9yaWdpbnMuSHR0cE9yaWdpbihhcGlHYXRld2F5RG9tYWluLCB7XG4gICAgICBwcm90b2NvbFBvbGljeTogY2xvdWRmcm9udC5PcmlnaW5Qcm90b2NvbFBvbGljeS5IVFRQU19PTkxZLFxuICAgICAgb3JpZ2luUGF0aDogJycsXG4gICAgfSk7XG5cbiAgICBkaXN0cmlidXRpb24uYWRkQmVoYXZpb3IoJy9hcGkvKicsIGFwaU9yaWdpbiwge1xuICAgICAgYWxsb3dlZE1ldGhvZHM6IGNsb3VkZnJvbnQuQWxsb3dlZE1ldGhvZHMuQUxMT1dfQUxMLFxuICAgICAgdmlld2VyUHJvdG9jb2xQb2xpY3k6IGNsb3VkZnJvbnQuVmlld2VyUHJvdG9jb2xQb2xpY3kuSFRUUFNfT05MWSxcbiAgICAgIGNhY2hlUG9saWN5OiBjbG91ZGZyb250LkNhY2hlUG9saWN5LkNBQ0hJTkdfRElTQUJMRUQsXG4gICAgICBvcmlnaW5SZXF1ZXN0UG9saWN5OiBjbG91ZGZyb250Lk9yaWdpblJlcXVlc3RQb2xpY3kuQUxMX1ZJRVdFUl9FWENFUFRfSE9TVF9IRUFERVIsXG4gICAgfSk7XG5cbiAgICAvLyDilIDilIAgNS4gQnVja2V0RGVwbG95bWVudCDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIDilIBcbiAgICAvLyBSZXNvbHZlIHRoZSBidWlsZCBvdXRwdXQgcGF0aCByZWxhdGl2ZSB0byB0aGUgaW5mcmEgZGlyZWN0b3J5IHJvb3RcbiAgICBjb25zdCByZXNvbHZlZEJ1aWxkUGF0aCA9IHBhdGguaXNBYnNvbHV0ZShidWlsZE91dHB1dFBhdGgpXG4gICAgICA/IGJ1aWxkT3V0cHV0UGF0aFxuICAgICAgOiBwYXRoLmpvaW4oX19kaXJuYW1lLCAnLi4nLCAnLi4nLCAnLi4nLCBidWlsZE91dHB1dFBhdGgucmVwbGFjZSgvXlxcLlxcLlxcLy8sICcnKSk7XG5cbiAgICBuZXcgczNkZXBsb3kuQnVja2V0RGVwbG95bWVudCh0aGlzLCAnRGVwbG95RnJvbnRlbmQnLCB7XG4gICAgICBzb3VyY2VzOiBbczNkZXBsb3kuU291cmNlLmFzc2V0KHJlc29sdmVkQnVpbGRQYXRoKV0sXG4gICAgICBkZXN0aW5hdGlvbkJ1Y2tldDogY2xvdWRGcm9udFRvUzMuczNCdWNrZXRJbnRlcmZhY2UgYXMgY2RrLmF3c19zMy5JQnVja2V0LFxuICAgICAgZGlzdHJpYnV0aW9uLFxuICAgICAgZGlzdHJpYnV0aW9uUGF0aHM6IFsnLyonXSxcbiAgICAgIG1lbW9yeUxpbWl0OiAyNTYsXG4gICAgfSk7XG5cbiAgICB0aGlzLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWUgPSBkaXN0cmlidXRpb24uZGlzdHJpYnV0aW9uRG9tYWluTmFtZTtcblxuICAgIC8vIOKUgOKUgCA2LiBPdXRwdXRzIOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgOKUgFxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZEZyb250VVJMJywge1xuICAgICAgdmFsdWU6IGBodHRwczovLyR7ZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbkRvbWFpbk5hbWV9YCxcbiAgICAgIGRlc2NyaXB0aW9uOiAnQ2xvdWRGcm9udCBkaXN0cmlidXRpb24gVVJMJyxcbiAgICB9KTtcblxuICAgIG5ldyBjZGsuQ2ZuT3V0cHV0KHRoaXMsICdDbG91ZEZyb250RGlzdHJpYnV0aW9uSWQnLCB7XG4gICAgICB2YWx1ZTogZGlzdHJpYnV0aW9uLmRpc3RyaWJ1dGlvbklkLFxuICAgICAgZGVzY3JpcHRpb246ICdDbG91ZEZyb250IGRpc3RyaWJ1dGlvbiBJRCcsXG4gICAgfSk7XG4gIH1cbn1cbiJdfQ==