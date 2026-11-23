import { Stack, Tags, type StackProps } from "aws-cdk-lib";
import type { Construct } from "constructs";

/**
 * Root stack. Empty for now: later tasks add DynamoDB tables, SQS, Lambda and so on.
 * Keep it inside the $0 rules from CLAUDE.md (no NAT, RDS, ALB, Fargate, EKS, MSK,
 * Secrets Manager, custom KMS keys; Lambda outside a VPC).
 */
export class ArgStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);
    Tags.of(this).add("project", "agent-reliability-gateway");
  }
}
