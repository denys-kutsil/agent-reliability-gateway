# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Status

The repository is at the very start of Stage 1: monorepo scaffold, CI and local mode exist (`packages/core` is still a placeholder); the gateway itself is not written yet. Everything below describes the intended design from the project plan. Work is tracked as numbered issues (ARG-nn) in Linear (workspace "Agent Reliability Gateway", https://linear.app/agent-reliability-gateway), which is the source of truth for tasks and acceptance criteria. Read the issue before implementing anything.

## What this is

A personal research project with a reference implementation, not a product and not a competitor to Kong or Temporal. An MCP gateway sits between an AI agent and unreliable external HTTP APIs. The model decides what to do; the gateway guarantees it is done safely, however the model behaves. The project is also an experiment: the same agent tasks run with and without the gateway under injected faults, and the numbers (duplicate actions, success rate, p95, calls per task) are the main output.

Guarantees: argument validation, idempotency, retries with backoff, reconcile after write timeouts, rate limits, circuit breaker, per-task budgets, audit.

## Commands

Stack: pnpm workspaces monorepo, TypeScript strict, Node 22, Vitest. Before finishing any task these must be green:

```
pnpm lint
pnpm typecheck
pnpm test
```

Local mode (needs Docker, no AWS account and no keys):

```
pnpm run setup    # install, docker compose up, wait for healthchecks, create DynamoDB tables and Postgres schema; safe to re-run
pnpm run doctor   # checks Node, Docker, free ports (5432, 8000) and says what to fix
```

Always use `pnpm run setup` and `pnpm run doctor`: bare `pnpm setup` and `pnpm doctor` are built-in pnpm commands and do not run these scripts (`pnpm setup` edits the shell profile). Local infrastructure is defined in `docker-compose.yml` (PostgreSQL with pgvector, DynamoDB Local); defaults are in `scripts/config.mjs`, overridable via `.env`.

AWS (real account, Free plan; never as root): work under the SSO profile, e.g. `AWS_PROFILE=my-project`. The bare `default` profile is intentionally not logged in.

```
AWS_PROFILE=my-project pnpm deploy:aws    # cdk deploy of packages/infra
AWS_PROFILE=my-project pnpm destroy:aws   # cdk destroy; removes the stack, not the CDK bootstrap resources
```

`pnpm deploy` is also a pnpm built-in, so scripts call `pnpm --filter @arg/infra run deploy`; always use the `:aws` scripts. `cdk bootstrap` was run once for account/region `us-east-1`.

Mock providers (Calendar, Email, CRM), local HTTP server on port 8081 (`/calendar`, `/email`, `/crm`):

```
pnpm mock                       # state in memory, no Docker needed
pnpm mock --state=dynamodb      # state in DynamoDB Local (table arg_mock_state; run `pnpm run setup` first)
```

Planned, not yet present (Stage 1 and later): `pnpm demo` (local run, no AWS account or LLM keys needed), `pnpm demo:llm`, `pnpm ingest`, `pnpm eval`. Add exact commands here, including how to run a single test, once the tooling exists. LLM evals and retrieval evals are run manually, not in CI.

## Architecture

Ports and adapters.

- `packages/core` is pure logic: types, ports, pipeline, in-memory adapters. It must never import the AWS SDK, databases, HTTP frameworks or any other infrastructure code.
- Infrastructure (DynamoDB, SQS, S3, EventBridge, Postgres) lives in adapters injected through ports. In the NestJS control plane each port is a DI injection token and each adapter a provider; the core does not depend on Nest.
- The gateway contains no code for any specific external API. A new API is connected only through route rules in `reliability.yaml` (or the control plane): `match` (host, method, path), `auth` (header plus a secret reference), `policy` (idempotency `keyFrom`, retry, rate limit, circuit breaker, reconcile GET template). Never change gateway code to support a new API.
- API keys exist only in the gateway, as references to env or SSM, never as values in config or the database. The agent has no keys, so it cannot bypass the gateway.
- CI enforces import boundaries (dependency-cruiser): `core` and `gateway-mcp` must not import `providers-mock` or `rag`.

### Call pipeline

Fixed order for every call. Early exits are also audited and counted in metrics. Do not reorder or bypass stages.

1. Route rule + Zod validation + host allowlist (no rule: audit-only, or deny if allowlist is on)
2. Task budget (calls and cost per `taskId` from the call's `_meta`; falls back to the agent API key)
3. Idempotency (write calls only)
4. Circuit breaker (per provider/host)
5. Rate limit (per route)
6. Call with timeout and retry (only safe errors: 429, 503, read timeouts; full jitter, honours `Retry-After`; validation 4xx never retried)
7. Reconcile after write timeout (GET from the rule's template; no template means result "unknown", never a blind retry)
8. complete/release, audit, metrics, `EventBus` event

### Key design decisions

- Idempotency key is `sha256(taskId | method | URL | canonical body)`, or only the `keyFrom` fields of the rule. It is task-scoped because agents repeat an action as a new request. DynamoDB `PutItem` with `status = IN_PROGRESS` and `leaseUntil`, condition `attribute_not_exists(pk) OR (status = IN_PROGRESS AND leaseUntil < :now)`. A parallel duplicate gets `in_progress`, not a second provider call. TTL 24h.
- Token bucket: `tokens` and `updatedAt` in one record, `UpdateItem` conditioned on the previous `updatedAt` (optimistic locking); on conflict re-read and retry. Rate limits learned from `Retry-After`, `RateLimit` and `X-RateLimit-*` headers; 429 halves the rate and recovers slowly (AIMD). With no rule and no headers a conservative per-host default applies.
- Circuit breaker: CLOSED, OPEN after N failures in a window, then exactly one probe after cooldown, claimed with a conditional write.
- 401: one token refresh (OAuth2) and retry; a second 401 raises a "key invalid" alert, no retry loop.
- Ports: `IdempotencyStore`, `RateLimitStore`, `CircuitStore`, `BudgetStore`, `AuditSink`, `EventBus`, `Clock`, `RouteTable`, `Upstream` (plus `LlmClient` in the LLM layer). Tests use in-memory adapters and a `FakeClock`.
- Routes are read by the gateway with a 30s cache; in local mode without the control plane, from `reliability.yaml`.

### Packages (planned)

- `packages/core`: types, ports, pipeline, in-memory adapters.
- `packages/adapters-aws`: DynamoDB, SQS, S3, EventBridge adapters.
- `packages/gateway-mcp`: MCP server (stdio first, Streamable HTTP later) exposing `http_request`, plus the `gateway://status` resource.
- `packages/control-plane`: NestJS (Passport JWT, class-validator, throttler, Terminus): auth with refresh rotation, password reset, RBAC via `@Roles` and `Reflector`, agent API keys, limits/budgets/audit endpoints.
- `packages/llm`: `LlmClient` (OpenAI-compatible: Gemini, OpenRouter fallback), structured outputs from the same Zod schemas with one repair attempt, cost accounting, evals.
- `packages/rag`: separate MCP knowledge server (`search_docs`): ingest, hybrid search (pgvector + full-text, RRF), recall@k and MRR.
- `packages/providers-mock`: three deliberately different mock HTTP APIs (Calendar, Email, CRM) with seeded fault injection (profiles low 5%, high 25%, outage 2 min; modes 429, 5xx, timeout without action, "action done but response lost"). The seed comes from the request id so every configuration sees the same fault sequence.
- `packages/worker`: Lambda, SQS to provider to jobs table; poison messages go to a DLQ.
- `packages/agent`: scripted and LLM agents, experiment runner.
- `packages/infra`: AWS CDK v2 app. Also `corpus/` (provider rules in markdown for RAG), `analysis/` (Python with uv, pandas, matplotlib), `experiments/` (run configs and JSONL results), `docs/` (ADRs, design doc).

### Data

Gateway state lives in DynamoDB (DynamoDB Local in Docker locally): idempotency, rate limits, circuits, task budgets, jobs, mock state. Control plane data (users, refresh tokens, password resets, API keys, routes) and RAG `doc_chunks` (pgvector, HNSW + GIN indexes, 768-dim Gemini embeddings) live in PostgreSQL in Docker. Audit goes to S3 as JSONL batches (a file locally). Only token and key hashes are stored, never secrets.

## Stages and current focus

Stages 0 to 8 are tracked in Linear: 0 NestJS control plane, 1 foundation (monorepo, CI, local mode, mock providers, fault injection, run A), 2 gateway core (idempotency, retry, reconcile, runs B and C), 3 LLM layer, 4 RAG (run E), 5 protection and operations (token bucket, circuit breaker, budgets, async via SQS, audit), 6 deeper MCP, events and OpenTelemetry tracing, 7 system design doc, 8 analysis and publication.

Current focus is the minimum slice: Stage 1, then Stage 0, then Stage 2. Do not start later stages until this slice works end to end.

Experiment configurations: A no gateway (naive retries), B retries only, C retries + idempotency, D everything, E D + RAG for the LLM agent.

## Working rules

- One Linear issue per task, one branch per task. Independent tasks may run in parallel in separate git worktrees, one agent per worktree.
- Every behaviour change comes with tests. Reliability logic is tested with unit tests on in-memory adapters and `FakeClock`, concurrency tests (N parallel identical calls yield exactly one execution; the token bucket never exceeds its limit), and integration tests against DynamoDB Local and pgvector. DynamoDB TTL does not work locally and must be verified once in AWS.
- A task is done only when its acceptance criteria are met and verified.
- Keep the Linear issue status in sync with the work: set it to In Progress when starting a task, and to Done when the task is finished (acceptance criteria verified and its PR merged to `main`). Update the status right after each task, without waiting to be asked. Linear identifiers are `AGE-nn`; the `ARG-nn` in issue titles is the plan numbering.
- Record key decisions as short ADRs in `docs/adr/`.
- No secrets in code or committed config; `.env` is gitignored, `.env.example` documents every variable. Everything must start without a `.env`.
- Nothing from the author's previous employer (no code, internal names or data structures). Public wording is only "integrations with 811 providers in different US states".
- Keep the project at $0: AWS Free plan, no NAT Gateway, EKS, ECS/Fargate, RDS, ALB, MSK, Secrets Manager, public IPv4 or custom KMS keys; Lambda outside a VPC; LLM keys in SSM Parameter Store; pgvector only in Docker. All infrastructure is defined in CDK so it can be redeployed with one command and removed with `cdk destroy`.
- The repository stays private until the end of Stage 2, then goes public under MIT. Do not describe it as "production-ready" or "enterprise".
