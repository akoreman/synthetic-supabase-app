import * as cdk from 'aws-cdk-lib';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import { Construct } from 'constructs';
export interface LambdaStackProps extends cdk.StackProps {
    environment: string;
}
export declare class LambdaStack extends cdk.Stack {
    readonly api: apigateway.RestApi;
    readonly apiGatewayDomain: string;
    constructor(scope: Construct, id: string, props: LambdaStackProps);
}
