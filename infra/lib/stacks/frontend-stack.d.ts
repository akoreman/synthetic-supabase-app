import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
export interface FrontendStackProps extends cdk.StackProps {
    environment: string;
    buildOutputPath: string;
    apiGatewayDomain: string;
}
export declare class FrontendStack extends cdk.Stack {
    readonly distributionDomainName: string;
    constructor(scope: Construct, id: string, props: FrontendStackProps);
}
