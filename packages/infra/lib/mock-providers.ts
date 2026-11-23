import { fileURLToPath } from "node:url";
import { CfnOutput, Duration, RemovalPolicy } from "aws-cdk-lib";
import { AttributeType, BillingMode, Table } from "aws-cdk-lib/aws-dynamodb";
import { Architecture, FunctionUrlAuthType, Runtime } from "aws-cdk-lib/aws-lambda";
import { NodejsFunction } from "aws-cdk-lib/aws-lambda-nodejs";
import { LogGroup, RetentionDays } from "aws-cdk-lib/aws-logs";
import { Construct } from "constructs";

/**
 * The three mock providers (Calendar, Email, CRM) behind one Lambda and one Function URL.
 * Paths: /calendar/*, /email/*, /crm/*. The URL uses AWS_IAM, so every request must be SigV4-signed.
 * Everything here stays inside the free tier: Lambda outside a VPC, on-demand DynamoDB, 1-week logs.
 */
export class MockProviders extends Construct {
  readonly table: Table;
  readonly function: NodejsFunction;

  constructor(scope: Construct, id: string) {
    super(scope, id);

    this.table = new Table(this, "State", {
      partitionKey: { name: "pk", type: AttributeType.STRING },
      billingMode: BillingMode.PAY_PER_REQUEST,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.function = new NodejsFunction(this, "Handler", {
      entry: fileURLToPath(
        new URL("../../providers-mock/src/transport/lambda.ts", import.meta.url),
      ),
      handler: "handler",
      runtime: Runtime.NODEJS_22_X,
      architecture: Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(10),
      environment: { MOCK_STATE_TABLE: this.table.tableName },
      logGroup: new LogGroup(this, "Logs", {
        retention: RetentionDays.ONE_WEEK,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
    });
    // Least privilege: only what DynamoMockState uses (reads, and transactional puts/updates).
    this.table.grant(
      this.function,
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
      "dynamodb:ConditionCheckItem",
    );

    const url = this.function.addFunctionUrl({ authType: FunctionUrlAuthType.AWS_IAM });
    new CfnOutput(this, "Url", { value: url.url, description: "Mock providers (SigV4 required)" });
  }
}
