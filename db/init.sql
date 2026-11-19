-- Idempotent bootstrap for local PostgreSQL. Safe to run on every `pnpm run setup`.
-- Real tables arrive with their tickets (control plane: users, keys, routes; RAG: doc_chunks).
CREATE EXTENSION IF NOT EXISTS vector;
