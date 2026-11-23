import { describe, expect, it } from "vitest";
import { createCrmHandler } from "./crm.js";
import { json, req, testDeps } from "../testing/test-helpers.js";

const rpc = (method: string, params?: unknown, id: number | null = 1) =>
  req("POST", "/rpc", json({ id, method, params }));

const parse = (res: { body: string }) => JSON.parse(res.body) as Record<string, unknown>;

describe("crm", () => {
  it("creates a contact and reads it back by id", async () => {
    const handle = createCrmHandler(testDeps());
    const created = await handle(
      rpc("contacts.create", { name: "Ann", email: "ann@example.com", clientRef: "r1" }),
    );
    expect(created.status).toBe(200);
    expect(parse(created)).toMatchObject({
      id: 1,
      result: { contact: { id: "id-1", name: "Ann", clientRef: "r1" } },
    });

    const got = await handle(rpc("contacts.get", { id: "id-1" }, 2));
    expect(parse(got)).toMatchObject({ id: 2, result: { contact: { name: "Ann" } } });
  });

  it("reports errors inside a 200 body", async () => {
    const handle = createCrmHandler(testDeps());

    const invalid = await handle(rpc("contacts.create", { name: "", email: "x" }));
    expect(invalid.status).toBe(200);
    expect(parse(invalid)).toMatchObject({ error: { code: -32602 } });

    const missing = await handle(rpc("contacts.get", { id: "nope" }));
    expect(missing.status).toBe(200);
    expect(parse(missing)).toMatchObject({ error: { code: 404 } });

    const broken = await handle(req("POST", "/rpc", { body: "{" }));
    expect(broken.status).toBe(200);
    expect(parse(broken)).toMatchObject({ error: { code: -32700 } });
  });

  it("has no search method on purpose", async () => {
    const handle = createCrmHandler(testDeps());
    await handle(
      rpc("contacts.create", { name: "Ann", email: "ann@example.com", clientRef: "r1" }),
    );
    const res = await handle(rpc("contacts.search", { clientRef: "r1" }));
    expect(res.status).toBe(200);
    expect(parse(res)).toMatchObject({ error: { code: -32601 } });
  });

  it("answers wrong paths with a plain 404", async () => {
    const handle = createCrmHandler(testDeps());
    expect((await handle(req("GET", "/rpc"))).status).toBe(404);
    expect((await handle(req("POST", "/other"))).status).toBe(404);
  });
});
