import { Stack, Tags, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";
import { MockProviders } from "./mock-providers.js";

/**
 * Root stack. Grows task by task: mock providers now; DynamoDB state tables, SQS and the
 * worker later. Keep it inside the $0 rules from CLAUDE.md (no NAT, RDS, ALB, Fargate, EKS, MSK,
 * Secrets Manager, custom KMS keys; Lambda outside a VPC).
 */
export class ArgStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    Tags.of(this).add("project", "agent-reliability-gateway");
    new MockProviders(this, "MockProviders");
  }
}
