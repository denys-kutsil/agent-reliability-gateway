import type { CallResult, HttpClient } from "./http-client.js";

export interface NaiveAgentOptions {
  /** Total attempts per step, including the first one. */
  maxAttempts: number;
}

export interface TaskOutcome {
  taskId: string;
  success: boolean;
  /** HTTP requests sent, including repeats. */
  calls: number;
  durationMs: number;
  failedStep?: string;
}

interface Step {
  name: string;
  path: string;
  headers: Record<string, string>;
  body: string;
  /** CRM answers HTTP 200 even on errors, so success needs a look at the body. */
  isSuccess: (res: CallResult) => boolean;
}

const is2xx = (res: CallResult) =>
  res.status !== undefined && res.status >= 200 && res.status < 300;

function steps(taskId: string): Step[] {
  return [
    {
      name: "calendar",
      path: "/calendar/events",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: `Meeting ${taskId}`,
        start: "2026-01-01T10:00:00.000Z",
        end: "2026-01-01T11:00:00.000Z",
        clientRef: taskId,
      }),
      isSuccess: is2xx,
    },
    {
      name: "email",
      path: "/email/messages",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        to: "guest@example.com",
        subject: `Invitation ${taskId}`,
        body: "See you at the meeting.",
        client_ref: taskId,
      }).toString(),
      isSuccess: is2xx,
    },
    {
      name: "crm",
      path: "/crm/rpc",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        id: 1,
        method: "contacts.create",
        params: { name: "Guest", email: "guest@example.com", clientRef: taskId },
      }),
      isSuccess: (res) => {
        if (!is2xx(res)) return false;
        try {
          return !("error" in (JSON.parse(res.body) as object));
        } catch {
          return false;
        }
      },
    },
  ];
}

/**
 * Config A: the task "meeting, email, contact" with direct HTTP calls and naive retries.
 *
 * Naive means: any failure (non-2xx, timeout, dropped connection) is repeated at once, up to
 * `maxAttempts`. No Idempotency-Key, no check whether an earlier attempt already worked, no backoff.
 * The `clientRef` is sent only so the runner can later count records in the provider; the agent
 * never reads it back.
 */
export async function runNaiveTask(
  client: HttpClient,
  taskId: string,
  options: NaiveAgentOptions,
): Promise<TaskOutcome> {
  const started = performance.now();
  let calls = 0;

  for (const step of steps(taskId)) {
    let done = false;
    for (let attempt = 0; attempt < options.maxAttempts && !done; attempt++) {
      calls++;
      const res = await client.request({
        method: "POST",
        path: step.path,
        headers: {
          ...step.headers,
          // Same request id for every attempt of a step; only the attempt number changes.
          "x-request-id": `${taskId}-${step.name}`,
          "x-attempt": String(attempt),
        },
        body: step.body,
      });
      done = step.isSuccess(res);
    }
    if (!done) {
      return {
        taskId,
        success: false,
        calls,
        durationMs: performance.now() - started,
        failedStep: step.name,
      };
    }
  }
  return { taskId, success: true, calls, durationMs: performance.now() - started };
}
