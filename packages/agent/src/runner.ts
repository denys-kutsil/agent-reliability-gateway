import {
  createMockApp,
  defaultDeps,
  InMemoryMockState,
  startMockServer,
  type EntityKind,
  type FaultProfileName,
} from "@arg/providers-mock";
import { createHttpClient } from "./http-client.js";
import { duplicatesOf, type TaskRecord } from "./metrics.js";
import { runNaiveTask } from "./naive-agent.js";

export interface RunOptions {
  profile: FaultProfileName;
  tasks: number;
  /** Tasks in flight at once. */
  concurrency: number;
  maxAttempts: number;
  /** The agent gives up on one HTTP attempt after this long. */
  timeoutMs: number;
  /** How long the provider hangs on a simulated timeout. Must be longer than `timeoutMs`. */
  hangMs: number;
}

export const DEFAULT_RUN: Omit<RunOptions, "profile"> = {
  tasks: 200,
  concurrency: 10,
  maxAttempts: 3,
  timeoutMs: 300,
  hangMs: 1000,
};

const KINDS: [keyof TaskRecord["created"], EntityKind][] = [
  ["calendar", "calendar_event"],
  ["email", "email_message"],
  ["crm", "crm_contact"],
];

/** Task ids do not depend on the profile or config, so every run sees the same fault draws. */
export const taskIdFor = (index: number) => `task-${String(index + 1).padStart(4, "0")}`;

/** Config A: starts the mock providers in this process, runs the tasks, counts from their state. */
export async function runConfigA(options: RunOptions): Promise<TaskRecord[]> {
  if (options.hangMs <= options.timeoutMs) {
    throw new Error("hangMs must be longer than timeoutMs, or no request would ever time out");
  }
  const store = new InMemoryMockState();
  const app = createMockApp(defaultDeps({ store }), {
    profile: options.profile,
    hangMs: options.hangMs,
  });
  const { server, port, close } = await startMockServer(app, { port: 0 });
  const client = createHttpClient(`http://127.0.0.1:${String(port)}`, options.timeoutMs);

  try {
    const outcomes = new Array<Awaited<ReturnType<typeof runNaiveTask>>>(options.tasks);
    let next = 0;
    const worker = async () => {
      for (let i = next++; i < options.tasks; i = next++) {
        outcomes[i] = await runNaiveTask(client, taskIdFor(i), {
          maxAttempts: options.maxAttempts,
        });
      }
    };
    await Promise.all(Array.from({ length: options.concurrency }, worker));

    // Truth comes from the provider state, not from what the agent saw.
    const records: TaskRecord[] = [];
    for (const outcome of outcomes) {
      const created = { calendar: 0, email: 0, crm: 0 };
      for (const [name, kind] of KINDS) {
        created[name] = (await store.findByClientRef(kind, outcome.taskId)).length;
      }
      records.push({
        config: "A",
        profile: options.profile,
        taskId: outcome.taskId,
        success: outcome.success,
        calls: outcome.calls,
        durationMs: Math.round(outcome.durationMs),
        ...(outcome.failedStep === undefined ? {} : { failedStep: outcome.failedStep }),
        created,
        duplicates: KINDS.reduce((acc, [name]) => acc + duplicatesOf(created[name]), 0),
      });
    }
    return records;
  } finally {
    server.closeAllConnections();
    await close();
  }
}
