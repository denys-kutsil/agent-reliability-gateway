import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createMockApp } from "../app/router.js";
import { startMockServer } from "./server.js";
import { testDeps } from "../testing/test-helpers.js";

describe("local server (in-memory state, real HTTP)", () => {
  let base = "";
  let close: () => Promise<void> = () => Promise.resolve();

  beforeAll(async () => {
    const started = await startMockServer(createMockApp(testDeps()), { port: 0 });
    base = `http://127.0.0.1:${String(started.port)}`;
    close = started.close;
  });
  afterAll(() => close());

  it("creates a calendar event and finds it by clientRef", async () => {
    const created = await fetch(`${base}/calendar/events`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: "Standup",
        start: "2026-03-01T10:00:00Z",
        end: "2026-03-01T10:15:00Z",
        clientRef: "t1",
      }),
    });
    expect(created.status).toBe(201);

    const found = await fetch(`${base}/calendar/events?clientRef=t1`);
    const body = (await found.json()) as { items: { title: string }[] };
    expect(body.items).toHaveLength(1);
    expect(body.items[0]?.title).toBe("Standup");
  });

  it("serves email with an Idempotency-Key and CRM errors in a 200 body", async () => {
    const send = () =>
      fetch(`${base}/email/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/x-www-form-urlencoded",
          "idempotency-key": "k1",
        },
        body: new URLSearchParams({ to: "a@example.com", subject: "Hi", body: "Hello" }),
      });
    expect((await send()).status).toBe(202);
    expect((await send()).status).toBe(200);

    const crm = await fetch(`${base}/crm/rpc`, {
      method: "POST",
      body: JSON.stringify({ id: 1, method: "contacts.search" }),
    });
    expect(crm.status).toBe(200);
    expect(await crm.json()).toMatchObject({ error: { code: -32601 } });
  });

  it("returns 404 for an unknown provider", async () => {
    expect((await fetch(`${base}/nope/anything`)).status).toBe(404);
  });
});
