import { describe, expect, it } from "vitest";
import type { CallResult, HttpClient } from "./http-client.js";
import { runNaiveTask } from "./naive-agent.js";

const ok = (body = "{}"): CallResult => ({ status: 201, body, durationMs: 1 });
const crmOk = (): CallResult => ok(JSON.stringify({ id: 1, result: {} }));
const down = (): CallResult => ({ status: 503, body: "", durationMs: 1 });
const timeout = (): CallResult => ({ status: undefined, body: "", durationMs: 1 });

/** Answers from a script, one entry per request, and records what was sent. */
function scripted(answers: CallResult[]) {
  const sent: { path: string; headers: Record<string, string> }[] = [];
  const client: HttpClient = {
    request: (req) => {
      sent.push({ path: req.path, headers: req.headers });
      return Promise.resolve(answers.shift() ?? ok());
    },
  };
  return { client, sent };
}

describe("naive agent", () => {
  it("makes one call per step when nothing fails", async () => {
    const { client, sent } = scripted([ok(), ok(), crmOk()]);
    const out = await runNaiveTask(client, "t1", { maxAttempts: 3 });
    expect(out).toMatchObject({ success: true, calls: 3 });
    expect(sent.map((s) => s.path)).toEqual(["/calendar/events", "/email/messages", "/crm/rpc"]);
  });

  it("repeats a failed step at once, with the same request id and a new attempt number", async () => {
    const { client, sent } = scripted([down(), timeout(), ok(), ok(), crmOk()]);
    const out = await runNaiveTask(client, "t1", { maxAttempts: 3 });
    expect(out).toMatchObject({ success: true, calls: 5 });
    const calendar = sent.filter((s) => s.path === "/calendar/events");
    expect(new Set(calendar.map((s) => s.headers["x-request-id"]))).toEqual(
      new Set(["t1-calendar"]),
    );
    expect(calendar.map((s) => s.headers["x-attempt"])).toEqual(["0", "1", "2"]);
  });

  it("never sends an Idempotency-Key", async () => {
    const { client, sent } = scripted([ok(), ok(), crmOk()]);
    await runNaiveTask(client, "t1", { maxAttempts: 3 });
    expect(sent.every((s) => !("idempotency-key" in s.headers))).toBe(true);
  });

  it("fails the task after maxAttempts and skips the later steps", async () => {
    const { client, sent } = scripted([ok(), down(), down(), down()]);
    const out = await runNaiveTask(client, "t1", { maxAttempts: 3 });
    expect(out).toMatchObject({ success: false, calls: 4, failedStep: "email" });
    expect(sent.some((s) => s.path === "/crm/rpc")).toBe(false);
  });

  it("treats a CRM answer with an error in the body as a failure", async () => {
    const crmError = ok(JSON.stringify({ id: 1, error: { code: -32602, message: "bad" } }));
    const { client } = scripted([ok(), ok(), crmError, crmError, crmError]);
    const out = await runNaiveTask(client, "t1", { maxAttempts: 3 });
    expect(out).toMatchObject({ success: false, failedStep: "crm" });
  });
});
