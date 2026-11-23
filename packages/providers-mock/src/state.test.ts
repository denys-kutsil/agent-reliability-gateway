import { describe, expect, it } from "vitest";
import { InMemoryMockState, type MockEntity } from "./state.js";

const entity = (over: Partial<MockEntity>): MockEntity => ({
  id: "1",
  kind: "calendar_event",
  data: {},
  createdAt: "2026-01-01T00:00:00.000Z",
  ...over,
});

describe("InMemoryMockState", () => {
  it("finds by clientRef only within the same kind", async () => {
    const s = new InMemoryMockState();
    await s.create(entity({ id: "a", clientRef: "r" }));
    await s.create(entity({ id: "b", kind: "crm_contact", clientRef: "r" }));
    expect((await s.findByClientRef("calendar_event", "r")).map((e) => e.id)).toEqual(["a"]);
    expect(await s.findByClientRef("calendar_event", "other")).toEqual([]);
  });

  it("gets by kind and id", async () => {
    const s = new InMemoryMockState();
    await s.create(entity({ id: "m", kind: "email_message" }));
    expect((await s.get("email_message", "m"))?.id).toBe("m");
    expect(await s.get("calendar_event", "m")).toBeUndefined();
  });

  it("returns the first entity when an idempotency key is reused", async () => {
    const s = new InMemoryMockState();
    const first = await s.create(entity({ id: "1", kind: "email_message", idempotencyKey: "k" }));
    const second = await s.create(entity({ id: "2", kind: "email_message", idempotencyKey: "k" }));
    expect(first.id).toBe("1");
    expect(second.id).toBe("1");
    expect(await s.get("email_message", "2")).toBeUndefined();
  });

  it("scopes idempotency keys to the kind", async () => {
    const s = new InMemoryMockState();
    await s.create(entity({ id: "1", kind: "email_message", idempotencyKey: "k" }));
    const other = await s.create(entity({ id: "2", kind: "crm_contact", idempotencyKey: "k" }));
    expect(other.id).toBe("2");
  });
});
