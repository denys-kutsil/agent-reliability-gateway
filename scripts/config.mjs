// Shared local-mode configuration. Every value has a default, so no .env is required.
// A .env file in the repo root, if present, overrides the defaults.
try {
  process.loadEnvFile();
} catch {
  // no .env: use defaults
}

const env = process.env;

export const config = {
  postgres: {
    user: env.POSTGRES_USER ?? "arg",
    database: env.POSTGRES_DB ?? "arg",
    port: Number(env.POSTGRES_PORT ?? 5432),
  },
  dynamodb: {
    endpoint: env.DYNAMODB_ENDPOINT ?? `http://127.0.0.1:${env.DYNAMODB_PORT ?? 8000}`,
    port: Number(env.DYNAMODB_PORT ?? 8000),
    region: env.AWS_REGION ?? "us-east-1",
  },
};

// Gateway state tables. All keyed by a single string partition key `pk`.
// Attributes (status, leaseUntil, tokens, ...) are schemaless and defined by the tickets that use them.
// TTL is enabled in AWS; DynamoDB Local ignores it, so it must be verified once in AWS.
export const tables = [
  "arg_idempotency",
  "arg_rate_limits",
  "arg_circuits",
  "arg_budgets",
  "arg_jobs",
  "arg_mock_state",
];
