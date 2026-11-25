/** What the agent sees after one HTTP attempt. */
export interface CallResult {
  /** HTTP status, or undefined when no answer came (timeout, dropped connection). */
  status: number | undefined;
  body: string;
  durationMs: number;
}

export interface HttpClient {
  request(req: {
    method: string;
    path: string;
    headers: Record<string, string>;
    body: string;
  }): Promise<CallResult>;
}

/** Plain fetch with a read timeout. No retries here: retry policy belongs to the agent. */
export function createHttpClient(baseUrl: string, timeoutMs: number): HttpClient {
  return {
    async request({ method, path, headers, body }) {
      const started = performance.now();
      try {
        const res = await fetch(`${baseUrl}${path}`, {
          method,
          headers,
          body,
          signal: AbortSignal.timeout(timeoutMs),
        });
        return {
          status: res.status,
          body: await res.text(),
          durationMs: performance.now() - started,
        };
      } catch {
        return { status: undefined, body: "", durationMs: performance.now() - started };
      }
    },
  };
}
