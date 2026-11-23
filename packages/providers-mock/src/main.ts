import { defaultDeps } from "./app/deps.js";
import { createDynamoMockState } from "./state/dynamodb-state.js";
import { parseProfile } from "./faults/faults.js";
import { createMockApp } from "./app/router.js";
import { startMockServer } from "./transport/server.js";

// Local mode entry point.
// Usage: tsx src/main.ts [--port=8081] [--state=memory|dynamodb] [--faults=none|low|high|outage]
// A request can override the profile with the `x-fault-profile` header.
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k = "", v = ""] = a.replace(/^--/, "").split("=");
    return [k, v] as const;
  }),
);
const port = Number(args.get("port") ?? 8081);
const state = args.get("state") ?? "memory";

const store =
  state === "dynamodb"
    ? createDynamoMockState({
        table: "arg_mock_state",
        region: process.env["AWS_REGION"] ?? "us-east-1",
        endpoint:
          process.env["DYNAMODB_ENDPOINT"] ??
          `http://127.0.0.1:${process.env["DYNAMODB_PORT"] ?? "8000"}`,
      })
    : undefined;

const profile = parseProfile(args.get("faults") ?? process.env["MOCK_FAULT_PROFILE"]) ?? "none";

const { port: bound } = await startMockServer(
  createMockApp(defaultDeps(store && { store }), { profile }),
  { port },
);
console.log(
  `mock providers on http://127.0.0.1:${String(bound)} (state: ${state}, faults: ${profile})`,
);
console.log("  /calendar/events   /email/messages   /crm/rpc");
