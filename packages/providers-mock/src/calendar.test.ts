import { describe, expect, it } from "vitest";
import { createCalendarHandler } from "./calendar.js";
import { json, req, testDeps } from "./test-helpers.js";

const event = {
  title: "Standup",
  start: "2026-03-01T10:00:00Z",
  end: "2026-03-01T10:15:00Z",
  clientRef: "task1-standup",
};

describe("calendar", () => {
  it("creates an event and finds it by clientRef", async () => {
    const handle = createCalendarHandler(testDeps());

    const created = await handle(req("POST", "/events", json(event)));
    expect(created.status).toBe(201);
    const body = JSON.parse(created.body) as { id: string };

    const found = await handle(req("GET", "/events?clientRef=task1-standup"));
    expect(found.status).toBe(200);
    const items = (JSON.parse(found.body) as { items: { id: string; title: string }[] }).items;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ id: body.id, title: "Standup", clientRef: "task1-standup" });
  });

  it("returns an empty list for an unknown clientRef", async () => {
    const handle = createCalendarHandler(testDeps());
    const found = await handle(req("GET", "/events?clientRef=nope"));
    expect(JSON.parse(found.body)).toEqual({ items: [] });
  });

  it("gets an event by id and 404s for a missing one", async () => {
    const handle = createCalendarHandler(testDeps());
    await handle(req("POST", "/events", json(event)));
    expect((await handle(req("GET", "/events/id-1"))).status).toBe(200);
    expect((await handle(req("GET", "/events/missing"))).status).toBe(404);
  });

  it("rejects invalid input with a 400 and an error code", async () => {
    const handle = createCalendarHandler(testDeps());
    const bad = await handle(req("POST", "/events", json({ ...event, title: "" })));
    expect(bad.status).toBe(400);
    expect(JSON.parse(bad.body)).toMatchObject({ error: { code: "invalid_argument" } });

    const backwards = await handle(
      req("POST", "/events", json({ ...event, end: "2026-03-01T09:00:00Z" })),
    );
    expect(backwards.status).toBe(400);

    const notJson = await handle(req("POST", "/events", { body: "{" }));
    expect(JSON.parse(notJson.body)).toMatchObject({ error: { code: "invalid_json" } });
  });

  it("requires clientRef for lookups and rejects unsupported methods", async () => {
    const handle = createCalendarHandler(testDeps());
    expect((await handle(req("GET", "/events"))).status).toBe(400);
    expect((await handle(req("DELETE", "/events"))).status).toBe(405);
    expect((await handle(req("GET", "/other"))).status).toBe(404);
  });
});
