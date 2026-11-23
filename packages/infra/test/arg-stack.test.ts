import { App } from "aws-cdk-lib";
import { Match, Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ArgStack } from "../lib/arg-stack.js";

// Resource types that cost money outside the free tier. The stack must never contain them.
const FORBIDDEN_TYPES = [
  "AWS::EC2::NatGateway",
  "AWS::EC2::EIP",
  "AWS::EC2::VPC",
  "AWS::RDS::DBInstance",
  "AWS::RDS::DBCluster",
  "AWS::ElasticLoadBalancingV2::LoadBalancer",
  "AWS::ECS::Cluster",
  "AWS::EKS::Cluster",
  "AWS::MSK::Cluster",
  "AWS::SecretsManager::Secret",
  "AWS::KMS::Key",
];

describe("ArgStack", () => {
  const template = Template.fromStack(new ArgStack(new App(), "TestStack"));

  it("contains no resource types that cost money", () => {
    const types = Object.values(template.toJSON().Resources ?? {}).map(
      (r) => (r as { Type: string }).Type,
    );
    for (const forbidden of FORBIDDEN_TYPES) {
      expect(types).not.toContain(forbidden);
    }
  });

  it("serves the mock providers through a Function URL that requires SigV4 (AWS_IAM)", () => {
    template.resourceCountIs("AWS::Lambda::Url", 1);
    template.hasResourceProperties("AWS::Lambda::Url", { AuthType: "AWS_IAM" });
  });

  it("runs the mock Lambda outside a VPC", () => {
    template.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Environment: { Variables: { MOCK_STATE_TABLE: Match.anyValue() } },
      VpcConfig: Match.absent(),
    });
  });

  it("uses an on-demand state table that is removed with the stack", () => {
    template.hasResource("AWS::DynamoDB::Table", {
      Properties: { BillingMode: "PAY_PER_REQUEST" },
      DeletionPolicy: "Delete",
    });
  });

  it("gives the Lambda only the DynamoDB actions it uses, on the state table only", () => {
    const statements = Object.values(template.findResources("AWS::IAM::Policy")).flatMap(
      (p) =>
        (
          p as {
            Properties: {
              PolicyDocument: { Statement: { Action: string[]; Resource: unknown[] }[] };
            };
          }
        ).Properties.PolicyDocument.Statement,
    );
    const actions = statements.flatMap((s) => s.Action).sort();
    expect(actions).toEqual([
      "dynamodb:ConditionCheckItem",
      "dynamodb:GetItem",
      "dynamodb:PutItem",
      "dynamodb:UpdateItem",
    ]);
    expect(JSON.stringify(statements.map((s) => s.Resource))).not.toContain('"*"');
  });
});
