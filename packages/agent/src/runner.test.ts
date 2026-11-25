import { describe, expect, it } from "vitest";
import { summarize } from "./metrics.js";
import { DEFAULT_RUN, runConfigA } from "./runner.js";

// Short hang so simulated timeouts do not slow the suite down.
const fast = { ...DEFAULT_RUN, tasks: 40, timeoutMs: 100, hangMs: 300 };

describe("runner, config A", () => {
  it("creates exactly one record per provider and no duplicates when nothing fails", async () => {
    const records = await runConfigA({ ...fast, profile: "none" });
    expect(records).toHaveLength(40);
    for (const r of records) {
      expect(r).toMatchObject({
        success: true,
        calls: 3,
        duplicates: 0,
        created: { calendar: 1, email: 1, crm: 1 },
      });
    }
  });

  it("counts duplicates from provider state when responses are lost", async () => {
    const records = await runConfigA({ ...fast, profile: "high", tasks: 120 });
    const s = summarize("high", records);
    // Under high faults some "lost response" writes get repeated by the naive agent.
    expect(s.totalDuplicates).toBeGreaterThan(0);
    // The agent's own call count and the provider's record count are independent facts.
    for (const r of records) {
      const created = r.created.calendar + r.created.email + r.created.crm;
      expect(created).toBeLessThanOrEqual(r.calls);
    }
  });

  it("gives the same faults to every run: same profile, same task ids, same outcome", async () => {
    const shape = (rs: Awaited<ReturnType<typeof runConfigA>>) =>
      rs.map((r) => [r.taskId, r.success, r.calls, r.duplicates, r.created]);
    const a = await runConfigA({ ...fast, profile: "high" });
    const b = await runConfigA({ ...fast, profile: "high" });
    expect(shape(a)).toEqual(shape(b));
  });

  it("rejects a hang shorter than the agent timeout", async () => {
    await expect(
      runConfigA({ ...fast, profile: "low", timeoutMs: 500, hangMs: 100 }),
    ).rejects.toThrow(/hangMs/);
  });
});
