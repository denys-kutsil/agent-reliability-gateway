import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { MockHandler, MockRequest } from "./http.js";

async function readRequest(incoming: IncomingMessage): Promise<MockRequest> {
  const chunks: Buffer[] = [];
  for await (const chunk of incoming) chunks.push(chunk as Buffer);
  const url = new URL(incoming.url ?? "/", "http://mock.local");
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value !== undefined) headers[name] = Array.isArray(value) ? value.join(", ") : value;
  }
  return {
    method: incoming.method ?? "GET",
    path: url.pathname,
    query: url.searchParams,
    headers,
    body: Buffer.concat(chunks).toString("utf8"),
  };
}

/** Plain Node HTTP server around a handler. Local mode only; Lambda uses its own adapter. */
export function startMockServer(
  handler: MockHandler,
  options: { port: number; host?: string },
): Promise<{ server: Server; port: number; close: () => Promise<void> }> {
  const server = createServer((incoming, outgoing) => {
    readRequest(incoming)
      .then(handler)
      .then((res) => {
        outgoing.writeHead(res.status, res.headers);
        outgoing.end(res.body);
      })
      .catch((err: unknown) => {
        outgoing.writeHead(500, { "content-type": "application/json" });
        outgoing.end(JSON.stringify({ error: String(err) }));
      });
  });

  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, options.host ?? "127.0.0.1", () => {
      resolve({
        server,
        port: (server.address() as AddressInfo).port,
        close: () =>
          new Promise<void>((done, fail) => {
            server.close((err) => (err ? fail(err) : done()));
          }),
      });
    });
  });
}
