import { createHash } from "node:crypto";
import {
  jsonResponse,
  type MockHandler,
  type MockRequest,
  type MockResponse,
} from "../transport/http.js";

export type FaultProfileName = "none" | "low" | "high" | "outage";
export type FaultMode = "rate_limit" | "server_error" | "timeout" | "lost_response";

export const FAULT_PROFILES: readonly FaultProfileName[] = ["none", "low", "high", "outage"];

/** Share of requests that fail, per profile. Outage is time-based, not a share. */
const FAULT_RATE: Record<Exclude<FaultProfileName, "outage">, number> = {
  none: 0,
  low: 0.05,
  high: 0.25,
};

/** Relative weight of each mode when a request is picked to fail. */
const MODE_WEIGHTS: readonly (readonly [FaultMode, number])[] = [
  ["rate_limit", 3],
  ["server_error", 3],
  ["timeout", 2],
  ["lost_response", 2],
];

export const OUTAGE_DURATION_MS = 2 * 60 * 1000;

export interface FaultOptions {
  /** Used when the request has no `x-fault-profile` header. */
  profile?: FaultProfileName;
  /** Clock for the outage window. Injectable for tests. */
  now?: () => number;
  /** How long a "timeout" or "lost_response" request hangs before the connection is dropped. */
  hangMs?: number;
  /** Value of the Retry-After header on 429, in seconds. */
  retryAfterSeconds?: number;
}

export function parseProfile(value: string | undefined): FaultProfileName | undefined {
  return FAULT_PROFILES.find((p) => p === value);
}

/** Stable key for the failure draw. Same request id and attempt always give the same key. */
function seedKey(req: MockRequest): string {
  const attempt = req.headers["x-attempt"] ?? "0";
  const id = req.headers["x-request-id"];
  // Without a request id, fall back to the request content so identical requests still match.
  const base = id ?? `${req.method}|${req.path}|${req.query.toString()}|${req.body}`;
  return `${base}#${attempt}`;
}

/** Two independent uniform numbers in [0, 1) derived from the seed. */
export function draw(key: string): [number, number] {
  const hash = createHash("sha256").update(key).digest();
  return [hash.readUInt32BE(0) / 2 ** 32, hash.readUInt32BE(4) / 2 ** 32];
}

function pickMode(u: number): FaultMode {
  const total = MODE_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);
  let acc = 0;
  for (const [mode, weight] of MODE_WEIGHTS) {
    acc += weight / total;
    if (u < acc) return mode;
  }
  return "server_error";
}

/** The fault for this request, or undefined when it should be served normally. */
export function decideFault(
  key: string,
  profile: Exclude<FaultProfileName, "outage">,
): FaultMode | undefined {
  const [roll, modeRoll] = draw(key);
  return roll < FAULT_RATE[profile] ? pickMode(modeRoll) : undefined;
}

function faultResponse(mode: FaultMode, options: Required<FaultOptions>): MockResponse {
  switch (mode) {
    case "rate_limit":
      return jsonResponse(
        429,
        { error: "rate limited" },
        { "retry-after": String(options.retryAfterSeconds) },
      );
    case "server_error":
      return jsonResponse(503, { error: "service unavailable" });
    case "timeout":
    case "lost_response":
      return { status: 504, headers: {}, body: "", abortAfterMs: options.hangMs };
  }
}

/**
 * Wraps a handler with seeded fault injection.
 *
 * - `rate_limit`, `server_error`, `timeout`: the action is NOT performed.
 * - `lost_response`: the action IS performed, then the response is dropped. This is the
 *   dangerous one: the caller sees a timeout and may repeat a write that already happened.
 * - outage: for 2 minutes after the first request every call gets a 503 and no action runs.
 */
export function withFaults(inner: MockHandler, options: FaultOptions = {}): MockHandler {
  const resolved: Required<FaultOptions> = {
    profile: options.profile ?? "none",
    now: options.now ?? Date.now,
    hangMs: options.hangMs ?? 5000,
    retryAfterSeconds: options.retryAfterSeconds ?? 1,
  };
  let outageStart: number | undefined;

  return async (req) => {
    const profile = parseProfile(req.headers["x-fault-profile"]) ?? resolved.profile;

    if (profile === "outage") {
      const now = resolved.now();
      outageStart ??= now;
      if (now - outageStart < OUTAGE_DURATION_MS) {
        return faultResponse("server_error", resolved);
      }
      return inner(req);
    }

    const mode = decideFault(seedKey(req), profile);
    if (mode === undefined) return inner(req);

    const response = faultResponse(mode, resolved);
    if (mode === "lost_response") {
      await inner(req); // the provider did the work; only the answer is lost
    }
    return response;
  };
}
