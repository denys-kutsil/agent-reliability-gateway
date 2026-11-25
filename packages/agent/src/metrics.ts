export interface TaskRecord {
  config: "A";
  profile: string;
  taskId: string;
  success: boolean;
  calls: number;
  durationMs: number;
  failedStep?: string;
  /** Records found in each provider for this task. Truth comes from the provider, not the agent. */
  created: { calendar: number; email: number; crm: number };
  /** Extra records beyond the first, summed over providers. */
  duplicates: number;
}

export interface Summary {
  profile: string;
  tasks: number;
  successRate: number;
  tasksWithDuplicates: number;
  duplicateRate: number;
  totalDuplicates: number;
  duplicatesByProvider: { calendar: number; email: number; crm: number };
  p95LatencyMs: number;
  callsPerTask: number;
}

export const duplicatesOf = (n: number) => Math.max(0, n - 1);

/** Nearest-rank percentile. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.max(0, rank - 1)] ?? 0;
}

export function summarize(profile: string, records: TaskRecord[]): Summary {
  const n = records.length;
  const sum = (f: (r: TaskRecord) => number) => records.reduce((acc, r) => acc + f(r), 0);
  const withDuplicates = records.filter((r) => r.duplicates > 0).length;
  return {
    profile,
    tasks: n,
    successRate: n === 0 ? 0 : records.filter((r) => r.success).length / n,
    tasksWithDuplicates: withDuplicates,
    duplicateRate: n === 0 ? 0 : withDuplicates / n,
    totalDuplicates: sum((r) => r.duplicates),
    duplicatesByProvider: {
      calendar: sum((r) => duplicatesOf(r.created.calendar)),
      email: sum((r) => duplicatesOf(r.created.email)),
      crm: sum((r) => duplicatesOf(r.created.crm)),
    },
    p95LatencyMs: percentile(
      records.map((r) => r.durationMs),
      95,
    ),
    callsPerTask: n === 0 ? 0 : sum((r) => r.calls) / n,
  };
}
