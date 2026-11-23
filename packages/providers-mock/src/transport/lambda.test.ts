import { describe, expect, it } from "vitest";
import { createLambdaHandler, type FunctionUrlEvent } from "./lambda.js";
import { createMockApp } from "../app/router.js";
import { testDeps } from "../testing/test-helpers.js";

const event = (
  method: string,
  rawPath: string,
  init: Partial<FunctionUrlEvent> = {},
): FunctionUrlEvent => ({ rawPath, requestContext: { http: { method } }, ...init });

describe("lambda adapter", () => {
  const handle = createLambdaHandler(createMockApp(testDeps()));

  it("creates a calendar event and finds it, like a Function URL event would", async () => {
    const created = await handle(
      event("POST", "/calendar/events", {
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          title: "Standup",
          start: "2026-03-01T10:00:00Z",
          end: "2026-03-01T10:15:00Z",
          clientRef: "lambda-1",
        }),
      }),
    );
    expect(created.statusCode).toBe(201);

    const found = await handle(
      event("GET", "/calendar/events", { rawQueryString: "clientRef=lambda-1" }),
    );
    expect(JSON.parse(found.body)).toMatchObject({ items: [{ title: "Standup" }] });
  });

  it("decodes a base64 body and lowercases header names", async () => {
    const body = new URLSearchParams({ to: "a@example.com", subject: "Hi", body: "Hello" });
    const res = await handle(
      event("POST", "/email/messages", {
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "Idempotency-Key": "k",
        },
        body: Buffer.from(body.toString()).toString("base64"),
        isBase64Encoded: true,
      }),
    );
    expect(res.statusCode).toBe(202);
  });
});
