/** Transport-neutral request/response, so the same handlers run in a Node server and in Lambda. */
export interface MockRequest {
  method: string;
  /** Path without the query string, e.g. "/events/abc". */
  path: string;
  query: URLSearchParams;
  /** Header names are lowercase. */
  headers: Record<string, string>;
  body: string;
}

export interface MockResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export type MockHandler = (req: MockRequest) => Promise<MockResponse>;

export function jsonResponse(
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): MockResponse {
  return {
    status,
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload),
  };
}
