import { defaultDeps, type ProviderDeps } from "./deps.js";
import type { MockRequest } from "./http.js";

export function testDeps(): ProviderDeps {
  let n = 0;
  return defaultDeps({
    newId: () => `id-${String(++n)}`,
    now: () => new Date("2026-01-01T00:00:00.000Z"),
  });
}

export function req(
  method: string,
  url: string,
  init: { headers?: Record<string, string>; body?: string } = {},
): MockRequest {
  const u = new URL(url, "http://mock.local");
  return {
    method,
    path: u.pathname,
    query: u.searchParams,
    headers: init.headers ?? {},
    body: init.body ?? "",
  };
}

export const json = (body: unknown) => ({
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

export const form = (fields: Record<string, string>, headers: Record<string, string> = {}) => ({
  headers: { "content-type": "application/x-www-form-urlencoded", ...headers },
  body: new URLSearchParams(fields).toString(),
});
