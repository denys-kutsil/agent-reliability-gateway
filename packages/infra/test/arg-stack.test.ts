import { App } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { describe, expect, it } from "vitest";
import { ArgStack } from "../lib/arg-stack.js";

// Resource types that cost money outside the free tier. The stack must never contain them.
const FORBIDDEN_TYPES = [
  "AWS::EC2::NatGateway",
  "AWS::EC2::EIP",
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

  it("synthesizes", () => {
    expect(template.toJSON()).toBeTypeOf("object");
  });

  it("contains no resource types that cost money", () => {
    const types = Object.values(template.toJSON().Resources ?? {}).map(
      (r) => (r as { Type: string }).Type,
    );
    for (const forbidden of FORBIDDEN_TYPES) {
      expect(types).not.toContain(forbidden);
    }
  });
});
