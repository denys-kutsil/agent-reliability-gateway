import { describe, expect, it } from "vitest";
import { percentile, summarize, type TaskRecord } from "./metrics.js";

const record = (over: Partial<TaskRecord>): TaskRecord => ({
  config: "A",
  profile: "high",
  taskId: "t",
  success: true,
  calls: 3,
  durationMs: 10,
  created: { calendar: 1, email: 1, crm: 1 },
  duplicates: 0,
  ...over,
});

describe("percentile", () => {
  it("uses nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(values, 95)).toBe(95);
    expect(percentile([5], 95)).toBe(5);
    expect(percentile([], 95)).toBe(0);
  });
});

describe("summarize", () => {
  it("counts a task with extra records as a duplicate even if it succeeded", () => {
    const s = summarize("high", [
      record({}),
      record({ created: { calendar: 3, email: 2, crm: 1 }, duplicates: 3, calls: 7 }),
      record({ success: false, created: { calendar: 1, email: 0, crm: 0 }, calls: 4 }),
      record({}),
    ]);
    expect(s.tasks).toBe(4);
    expect(s.successRate).toBe(0.75);
    expect(s.tasksWithDuplicates).toBe(1);
    expect(s.duplicateRate).toBe(0.25);
    expect(s.totalDuplicates).toBe(3);
    expect(s.duplicatesByProvider).toEqual({ calendar: 2, email: 1, crm: 0 });
    expect(s.callsPerTask).toBe((3 + 7 + 4 + 3) / 4);
  });

  it("handles an empty run", () => {
    expect(summarize("low", []).successRate).toBe(0);
  });
});
