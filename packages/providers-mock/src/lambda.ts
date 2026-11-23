import { defaultDeps } from "./deps.js";
import { createDynamoMockState } from "./dynamodb-state.js";
import type { MockHandler, MockRequest, MockResponse } from "./http.js";
import { createMockApp } from "./router.js";

/** The part of a Lambda Function URL event (payload format 2.0) that we use. */
export interface FunctionUrlEvent {
  rawPath: string;
  rawQueryString?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
  requestContext: { http: { method: string } };
}

export interface FunctionUrlResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function toMockRequest(event: FunctionUrlEvent): MockRequest {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(event.headers ?? {})) {
    if (value !== undefined) headers[name.toLowerCase()] = value;
  }
  const raw = event.body ?? "";
  return {
    method: event.requestContext.http.method,
    path: event.rawPath,
    query: new URLSearchParams(event.rawQueryString ?? ""),
    headers,
    body: event.isBase64Encoded === true ? Buffer.from(raw, "base64").toString("utf8") : raw,
  };
}

export function toFunctionUrlResult(res: MockResponse): FunctionUrlResult {
  return { statusCode: res.status, headers: res.headers, body: res.body };
}

export function createLambdaHandler(app: MockHandler) {
  return async (event: FunctionUrlEvent): Promise<FunctionUrlResult> =>
    toFunctionUrlResult(await app(toMockRequest(event)));
}

let cached: ReturnType<typeof createLambdaHandler> | undefined;

/** Lambda entry point. State lives in the DynamoDB table named by MOCK_STATE_TABLE. */
export const handler = (event: FunctionUrlEvent): Promise<FunctionUrlResult> => {
  cached ??= createLambdaHandler(
    createMockApp(
      defaultDeps({
        store: createDynamoMockState({
          table: process.env["MOCK_STATE_TABLE"] ?? "arg_mock_state",
          region: process.env["AWS_REGION"] ?? "us-east-1",
        }),
      }),
    ),
  );
  return cached(event);
};
