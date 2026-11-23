import { App } from "aws-cdk-lib";
import { ArgStack } from "../lib/arg-stack.js";

const app = new App();

new ArgStack(app, "ArgStack", {
  env: {
    account: process.env["CDK_DEFAULT_ACCOUNT"],
    region: process.env["CDK_DEFAULT_REGION"] ?? "us-east-1",
  },
});
