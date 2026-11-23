import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { createDynamoMockState } from "./dynamodb-state.js";
import type { MockEntity } from "./state.js";

// Integration test against DynamoDB Local (docker compose, table created by `pnpm run setup`).
// Skipped when DynamoDB Local is not reachable.
const endpoint = process.env["DYNAMODB_ENDPOINT"] ?? "http://127.0.0.1:8000";
const available = await fetch(endpoint, { signal: AbortSignal.timeout(500) }).then(
  () => true,
  () => false,
);

const entity = (over: Partial<MockEntity> = {}): MockEntity => ({
  id: randomUUID(),
  kind: "calendar_event",
  data: { title: "x" },
  createdAt: new Date().toISOString(),
  ...over,
});

describe.skipIf(!available)("DynamoMockState (DynamoDB Local)", () => {
  const store = createDynamoMockState({ table: "arg_mock_state", region: "us-east-1", endpoint });

  it("creates an entity and reads it back", async () => {
    const e = entity();
    await store.create(e);
    expect(await store.get("calendar_event", e.id)).toEqual(e);
    expect(await store.get("crm_contact", e.id)).toBeUndefined();
  });

  it("finds entities by clientRef", async () => {
    const ref = randomUUID();
    const a = entity({ clientRef: ref });
    const b = entity({ clientRef: ref, createdAt: new Date(Date.now() + 1000).toISOString() });
    await store.create(a);
    await store.create(b);
    expect((await store.findByClientRef("calendar_event", ref)).map((e) => e.id)).toEqual([
      a.id,
      b.id,
    ]);
    expect(await store.findByClientRef("calendar_event", randomUUID())).toEqual([]);
  });

  it("returns the first entity when an idempotency key is reused", async () => {
    const key = randomUUID();
    const first = await store.create(entity({ kind: "email_message", idempotencyKey: key }));
    const second = entity({ kind: "email_message", idempotencyKey: key });
    const result = await store.create(second);
    expect(result.id).toBe(first.id);
    expect(await store.get("email_message", second.id)).toBeUndefined();
  });

  it("lets exactly one of many parallel creates win an idempotency key", async () => {
    const key = randomUUID();
    const results = await Promise.all(
      Array.from({ length: 10 }, () =>
        store.create(entity({ kind: "email_message", idempotencyKey: key })),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
  });
});
