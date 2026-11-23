import { describe, expect, it } from "vitest";
import {
  decideFault,
  OUTAGE_DURATION_MS,
  parseProfile,
  withFaults,
  type FaultMode,
} from "./faults.js";
import { createMockApp } from "../app/router.js";
import { form, req, testDeps } from "../testing/test-helpers.js";

const mail = { to: "a@example.com", subject: "Hi", body: "Hello" };
const send = (id: string, headers: Record<string, string> = {}) =>
  req("POST", "/email/messages", form(mail, { "x-request-id": id, ...headers }));

const keys = Array.from({ length: 10_000 }, (_, i) => `req-${String(i)}#0`);

describe("fault decision", () => {
  it("gives the same failure sequence for the same seeds", () => {
    const run = () => keys.slice(0, 500).map((k) => decideFault(k, "high"));
    expect(run()).toEqual(run());
  });

  it("gives a different sequence for different seeds", () => {
    const a = keys.slice(0, 500).map((k) => decideFault(k, "high"));
    const b = keys.slice(500, 1000).map((k) => decideFault(k, "high"));
    expect(a).not.toEqual(b);
  });

  it("fails about 5% for low, 25% for high, never for none", () => {
    const share = (profile: "none" | "low" | "high") =>
      keys.filter((k) => decideFault(k, profile) !== undefined).length / keys.length;
    expect(share("none")).toBe(0);
    expect(share("low")).toBeGreaterThan(0.04);
    expect(share("low")).toBeLessThan(0.06);
    expect(share("high")).toBeGreaterThan(0.23);
    expect(share("high")).toBeLessThan(0.27);
  });

  it("uses all four modes", () => {
    const modes = new Set<FaultMode | undefined>(keys.map((k) => decideFault(k, "high")));
    expect(modes).toEqual(
      new Set(["rate_limit", "server_error", "timeout", "lost_response", undefined]),
    );
  });

  it("parses profile names", () => {
    expect(parseProfile("high")).toBe("high");
    expect(parseProfile("nonsense")).toBeUndefined();
    expect(parseProfile(undefined)).toBeUndefined();
  });
});

/** Find a request id that gets the wanted mode under the high profile. */
function idFor(mode: FaultMode | undefined): string {
  const id = keys
    .map((k) => k.replace(/#0$/, ""))
    .find((k) => decideFault(`${k}#0`, "high") === mode);
  if (id === undefined) throw new Error(`no id for ${String(mode)}`);
  return id;
}

describe("fault modes", () => {
  const options = { profile: "high", hangMs: 1 } as const;

  it("serves a request normally when no fault is drawn", async () => {
    const app = createMockApp(testDeps(), options);
    expect((await app(send(idFor(undefined)))).status).toBe(202);
  });

  it("rate_limit: 429 with Retry-After, no email sent", async () => {
    const deps = testDeps();
    const res = await createMockApp(deps, options)(send(idFor("rate_limit")));
    expect(res.status).toBe(429);
    expect(res.headers["retry-after"]).toBe("1");
    expect(await deps.store.get("email_message", "id-1")).toBeUndefined();
  });

  it("server_error: 503, no email sent", async () => {
    const deps = testDeps();
    const res = await createMockApp(deps, options)(send(idFor("server_error")));
    expect(res.status).toBe(503);
    expect(await deps.store.get("email_message", "id-1")).toBeUndefined();
  });

  it("timeout: connection hangs and the email is NOT sent", async () => {
    const deps = testDeps();
    const res = await createMockApp(deps, options)(send(idFor("timeout")));
    expect(res.abortAfterMs).toBe(1);
    expect(await deps.store.get("email_message", "id-1")).toBeUndefined();
  });

  it("lost_response: connection hangs but the email IS sent", async () => {
    const deps = testDeps();
    const res = await createMockApp(deps, options)(send(idFor("lost_response")));
    expect(res.abortAfterMs).toBe(1);
    expect(await deps.store.get("email_message", "id-1")).toBeDefined();
  });

  it("a different attempt of the same request id can get a different outcome", async () => {
    const id = idFor("server_error");
    const app = createMockApp(testDeps(), options);
    const outcomes = new Set<number>();
    for (let attempt = 0; attempt < 30; attempt++) {
      outcomes.add((await app(send(id, { "x-attempt": String(attempt) }))).status);
    }
    expect(outcomes.has(503)).toBe(true);
    expect(outcomes.has(202)).toBe(true);
  });

  it("the x-fault-profile header overrides the configured profile", async () => {
    const app = createMockApp(testDeps(), { profile: "none" });
    const res = await app(send(idFor("rate_limit"), { "x-fault-profile": "high" }));
    expect(res.status).toBe(429);
  });
});

describe("outage", () => {
  it("fails every call for 2 minutes, then recovers", async () => {
    let now = 1_000_000;
    const app = withFaults(createMockApp(testDeps()), { profile: "outage", now: () => now });
    expect((await app(send("a"))).status).toBe(503);
    now += OUTAGE_DURATION_MS - 1;
    expect((await app(send("b"))).status).toBe(503);
    now += 1;
    expect((await app(send("c"))).status).toBe(202);
  });
});
