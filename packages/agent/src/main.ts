import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { parseProfile } from "@arg/providers-mock";
import { summarize } from "./metrics.js";
import { DEFAULT_RUN, runConfigA } from "./runner.js";

// Usage: tsx src/main.ts [--tasks=200] [--profiles=low,high] [--out=<dir>]
const args = new Map(
  process.argv.slice(2).map((a) => {
    const [k = "", v = ""] = a.replace(/^--/, "").split("=");
    return [k, v] as const;
  }),
);
const tasks = Number(args.get("tasks") ?? DEFAULT_RUN.tasks);
const profiles = (args.get("profiles") ?? "low,high").split(",");
const outDir = args.get("out") ?? fileURLToPath(new URL("../../../experiments/A", import.meta.url));

await mkdir(outDir, { recursive: true });
const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const rows: Record<string, string | number>[] = [];

for (const name of profiles) {
  const profile = parseProfile(name);
  if (profile === undefined) throw new Error(`unknown profile: ${name}`);
  console.log(`config A, profile ${profile}, ${String(tasks)} tasks ...`);
  const records = await runConfigA({ ...DEFAULT_RUN, tasks, profile });
  await writeFile(
    `${outDir}/${profile}.jsonl`,
    records.map((r) => JSON.stringify(r)).join("\n") + "\n",
  );

  const s = summarize(profile, records);
  await writeFile(`${outDir}/${profile}.summary.json`, JSON.stringify(s, null, 2) + "\n");
  rows.push({
    profile,
    tasks: s.tasks,
    success: pct(s.successRate),
    "tasks with dup": pct(s.duplicateRate),
    "dup total": s.totalDuplicates,
    "dup cal/mail/crm": `${String(s.duplicatesByProvider.calendar)}/${String(s.duplicatesByProvider.email)}/${String(s.duplicatesByProvider.crm)}`,
    "p95 ms": Math.round(s.p95LatencyMs),
    "calls/task": s.callsPerTask.toFixed(2),
  });
}

console.table(rows);
console.log(`results written to ${outDir}`);
