// `pnpm run setup`: doctor -> docker compose up -> wait for healthchecks -> create tables and schema.
// Safe to run repeatedly. Needs no AWS account and no keys.
import { execFileSync, spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { CreateTableCommand, DynamoDBClient, ListTablesCommand } from "@aws-sdk/client-dynamodb";
import { config, tables } from "./config.mjs";
import { report, runChecks } from "./doctor.mjs";

const step = (msg) => console.log(`\n==> ${msg}`);

function compose(args, options = {}) {
  return spawnSync("docker", ["compose", ...args], { encoding: "utf8", ...options });
}

async function waitHealthy(service, timeoutMs = 120_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const id = execFileSync("docker", ["compose", "ps", "-q", service], {
      encoding: "utf8",
    }).trim();
    if (id) {
      const status = execFileSync(
        "docker",
        [
          "inspect",
          "--format",
          "{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}",
          id,
        ],
        { encoding: "utf8" },
      ).trim();
      if (status === "healthy") return;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(
    `${service} did not become healthy within ${timeoutMs / 1000}s. Try: docker compose logs ${service}`,
  );
}

async function createDynamoTables() {
  const client = new DynamoDBClient({
    endpoint: config.dynamodb.endpoint,
    region: config.dynamodb.region,
    // DynamoDB Local accepts any credentials; these are not real.
    credentials: { accessKeyId: "local", secretAccessKey: "local" },
  });
  const existing = new Set((await client.send(new ListTablesCommand({}))).TableNames ?? []);
  for (const TableName of tables) {
    if (existing.has(TableName)) {
      console.log(`  exists   ${TableName}`);
      continue;
    }
    await client.send(
      new CreateTableCommand({
        TableName,
        AttributeDefinitions: [{ AttributeName: "pk", AttributeType: "S" }],
        KeySchema: [{ AttributeName: "pk", KeyType: "HASH" }],
        BillingMode: "PAY_PER_REQUEST",
      }),
    );
    console.log(`  created  ${TableName}`);
  }
  client.destroy();
}

function applyPostgresSchema() {
  const sql = readFileSync(new URL("../db/init.sql", import.meta.url), "utf8");
  const res = compose(
    [
      "exec",
      "-T",
      "postgres",
      "psql",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      config.postgres.user,
      "-d",
      config.postgres.database,
    ],
    { input: sql },
  );
  if (res.status !== 0) throw new Error(`psql failed:\n${res.stderr}`);
  console.log("  applied  db/init.sql");
}

step("Checking environment");
if (!report(await runChecks())) {
  console.log("\nFix the items marked FAIL and run `pnpm run setup` again.");
  process.exit(1);
}

step("Starting containers");
const up = compose(["up", "-d"], { stdio: "inherit" });
if (up.status !== 0) process.exit(up.status ?? 1);

step("Waiting for healthchecks");
await waitHealthy("postgres");
console.log("  postgres        healthy");
await waitHealthy("dynamodb-local");
console.log("  dynamodb-local  healthy");

step("Creating DynamoDB tables");
await createDynamoTables();

step("Applying PostgreSQL schema");
applyPostgresSchema();

console.log("\nSetup complete. Local mode needs no AWS account and no keys.");
