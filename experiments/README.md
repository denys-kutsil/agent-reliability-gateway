# Experiments

Same agent tasks, same injected faults, different protection. Results are JSONL files, one line per
task.

Configurations: A no gateway (naive retries), B retries only, C retries + idempotency, D everything,
E D + RAG.

## Run A: no gateway, naive retries

### Hypothesis (written before the first run)

Author's guesses, recorded before any number exists:

- At profile `high` (25% of requests fail), more than 30% of tasks will have at least one duplicate.
- More than 95% of tasks will still finish successfully, because the naive agent keeps retrying.
- The failure mode that creates the most duplicates will be the timeout.

Do not edit this section after the run. If the numbers disagree, add the explanation below the
results.

### Definitions

- Task: create a calendar event, send an email, create a CRM contact, in that order.
- Duplicate: every extra record with the same `clientRef` in one provider. An event created 3 times
  is 2 duplicates.
- Source of truth: the provider state, not what the agent reports. The agent does not know it made a
  duplicate.
- Success: the agent finished all three steps without a final error. A successful task can still
  have duplicates.
- Metrics: success rate, share of tasks with duplicates, duplicates per task, p95 task latency,
  calls per task.

### Agent under test

The agent calls the providers directly. On any non-2xx answer, timeout or network error it repeats
the same request at once, up to 3 attempts per step. It sends no `Idempotency-Key` and never checks
whether an earlier attempt already worked.

It sends `x-request-id` (task and step) and `x-attempt` (0, 1, 2) so every configuration sees the
same fault sequence.

### Results

200 tasks per profile, 3 attempts per step, agent timeout 300 ms, simulated hang 1000 ms. Raw data:
`experiments/A/{low,high}.jsonl`, summaries: `experiments/A/*.summary.json`. Reproduce with
`pnpm experiment:a`.

| profile | success | tasks with dup | dup cal / mail / crm | p95    | calls/task |
| ------- | ------- | -------------- | -------------------- | ------ | ---------- |
| low     | 100.0%  | 3.5% (7 dup)   | 1 / 4 / 2            | 301 ms | 3.15       |
| high    | 96.5%   | 17.0% (38 dup) | 13 / 15 / 10         | 603 ms | 3.89       |

### Against the hypothesis

- Duplicates at `high`: guessed more than 30% of tasks, measured 17.0%. The guess was too high.
- Success: guessed more than 95%, measured 96.5% at `high` and 100% at `low`. The guess held.
- Mode with the most duplicates: guessed timeout. This run does not record the mode per request, so
  it is not measured. By construction a plain timeout does not perform the action, so a repeat
  creates the first record, not a second one. Duplicates can only come from "action done, response
  lost".

### Caveats

- p95 latency depends on the settings above: an attempt that hits a simulated timeout costs about
  300 ms, so p95 mostly counts timed-out attempts. Compare it only between configurations run with
  the same settings.
- One seed, one run per profile. Not a statistical claim.
