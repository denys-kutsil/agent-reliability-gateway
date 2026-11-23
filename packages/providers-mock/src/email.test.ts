import { describe, expect, it } from "vitest";
import { createEmailHandler } from "./email.js";
import { form, json, req, testDeps } from "./test-helpers.js";

const mail = { to: "a@example.com", subject: "Hi", body: "Hello" };

describe("email", () => {
  it("accepts a form-encoded message", async () => {
    const handle = createEmailHandler(testDeps());
    const res = await handle(req("POST", "/messages", form(mail)));
    expect(res.status).toBe(202);
    expect(JSON.parse(res.body)).toMatchObject({ id: "id-1", status: "queued", to: mail.to });
  });

  it("does not send twice for the same Idempotency-Key", async () => {
    const deps = testDeps();
    const handle = createEmailHandler(deps);
    const first = await handle(req("POST", "/messages", form(mail, { "idempotency-key": "k1" })));
    const second = await handle(req("POST", "/messages", form(mail, { "idempotency-key": "k1" })));

    expect(first.status).toBe(202);
    expect(second.status).toBe(200);
    expect(second.headers["idempotent-replayed"]).toBe("true");
    expect(JSON.parse(second.body)).toEqual(JSON.parse(first.body));
    expect(await deps.store.get("email_message", "id-2")).toBeUndefined();
  });

  it("sends separate messages for different keys or no key", async () => {
    const deps = testDeps();
    const handle = createEmailHandler(deps);
    await handle(req("POST", "/messages", form(mail, { "idempotency-key": "a" })));
    await handle(req("POST", "/messages", form(mail, { "idempotency-key": "b" })));
    await handle(req("POST", "/messages", form(mail)));
    await handle(req("POST", "/messages", form(mail)));
    expect(await deps.store.get("email_message", "id-4")).toBeDefined();
  });

  it("reports field errors as a list with HTTP 422", async () => {
    const handle = createEmailHandler(testDeps());
    const res = await handle(req("POST", "/messages", form({ ...mail, to: "not-an-email" })));
    expect(res.status).toBe(422);
    expect(JSON.parse(res.body)).toMatchObject({ errors: [{ field: "to" }] });
  });

  it("rejects JSON bodies with 415", async () => {
    const handle = createEmailHandler(testDeps());
    expect((await handle(req("POST", "/messages", json(mail)))).status).toBe(415);
  });

  it("has no search: listing messages is not available", async () => {
    const handle = createEmailHandler(testDeps());
    await handle(req("POST", "/messages", form({ ...mail, client_ref: "r1" })));
    expect((await handle(req("GET", "/messages?client_ref=r1"))).status).toBe(405);
  });

  it("gets a message by id", async () => {
    const handle = createEmailHandler(testDeps());
    await handle(req("POST", "/messages", form(mail)));
    expect((await handle(req("GET", "/messages/id-1"))).status).toBe(200);
    expect((await handle(req("GET", "/messages/nope"))).status).toBe(404);
  });
});
