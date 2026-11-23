import { z } from "zod";
import type { ProviderDeps } from "../app/deps.js";
import { jsonResponse, type MockHandler, type MockResponse } from "../transport/http.js";
import type { MockEntity } from "../state/state.js";

/**
 * CRM: JSON-RPC-like. Every answer to `POST /rpc` is HTTP 200; failures are in the body as
 * `{ id, error: { code, message } }`. There is deliberately no search method, so a caller cannot
 * check whether a create already happened (the honest limitation the experiment shows).
 */
const Request = z.object({
  id: z.union([z.string(), z.number()]).nullable().optional(),
  method: z.string(),
  params: z.record(z.string(), z.unknown()).optional(),
});

const CreateContact = z.object({
  name: z.string().min(1),
  email: z.email(),
  clientRef: z.string().min(1).optional(),
});

const GetContact = z.object({ id: z.string().min(1) });

const rpcError = (id: unknown, code: number, message: string): MockResponse =>
  jsonResponse(200, { id: id ?? null, error: { code, message } });

const view = (e: MockEntity) => ({
  id: e.id,
  ...e.data,
  ...(e.clientRef === undefined ? {} : { clientRef: e.clientRef }),
});

export function createCrmHandler(deps: ProviderDeps): MockHandler {
  return async (req) => {
    if (req.path !== "/rpc" || req.method !== "POST") {
      return jsonResponse(404, { message: "Not found" });
    }

    let raw: unknown;
    try {
      raw = JSON.parse(req.body);
    } catch {
      return rpcError(null, -32700, "Parse error");
    }
    const request = Request.safeParse(raw);
    if (!request.success) return rpcError(null, -32600, "Invalid request");
    const { id, method, params } = request.data;

    switch (method) {
      case "contacts.create": {
        const p = CreateContact.safeParse(params);
        if (!p.success) return rpcError(id, -32602, p.error.issues[0]?.message ?? "Invalid params");
        const { name, email, clientRef } = p.data;
        const entity: MockEntity = {
          id: deps.newId(),
          kind: "crm_contact",
          ...(clientRef === undefined ? {} : { clientRef }),
          data: { name, email },
          createdAt: deps.now().toISOString(),
        };
        await deps.store.create(entity);
        return jsonResponse(200, { id: id ?? null, result: { contact: view(entity) } });
      }
      case "contacts.get": {
        const p = GetContact.safeParse(params);
        if (!p.success) return rpcError(id, -32602, p.error.issues[0]?.message ?? "Invalid params");
        const entity = await deps.store.get("crm_contact", p.data.id);
        return entity
          ? jsonResponse(200, { id: id ?? null, result: { contact: view(entity) } })
          : rpcError(id, 404, "Contact not found");
      }
      default:
        return rpcError(id, -32601, `Method not found: ${method}`);
    }
  };
}
