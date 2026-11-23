import { z } from "zod";
import type { ProviderDeps } from "./deps.js";
import { jsonResponse, type MockHandler, type MockResponse } from "./http.js";
import type { MockEntity } from "./state.js";

/**
 * Email: form-encoded request, errors as `{ errors: [{ field, message }] }` (HTTP 422).
 * Has its own `Idempotency-Key` header: a repeat with the same key returns the first message
 * and sends nothing new. There is no search, so there is no way to look a message up by clientRef.
 */
const SendMessage = z.object({
  to: z.email(),
  subject: z.string().min(1),
  body: z.string().min(1),
  client_ref: z.string().min(1).optional(),
});

const view = (e: MockEntity) => ({ id: e.id, status: "queued", ...e.data });

const notFound = (): MockResponse => jsonResponse(404, { errors: [{ message: "Not found" }] });

export function createEmailHandler(deps: ProviderDeps): MockHandler {
  return async (req) => {
    if (req.path === "/messages") {
      if (req.method !== "POST") {
        return jsonResponse(405, { errors: [{ message: `${req.method} is not allowed` }] });
      }
      if (!(req.headers["content-type"] ?? "").startsWith("application/x-www-form-urlencoded")) {
        return jsonResponse(415, {
          errors: [{ message: "Content-Type must be application/x-www-form-urlencoded" }],
        });
      }
      const parsed = SendMessage.safeParse(
        Object.fromEntries(new URLSearchParams(req.body).entries()),
      );
      if (!parsed.success) {
        return jsonResponse(422, {
          errors: parsed.error.issues.map((i) => ({
            field: i.path.join("."),
            message: i.message,
          })),
        });
      }

      const key = req.headers["idempotency-key"];

      const { to, subject, body, client_ref: clientRef } = parsed.data;
      const entity: MockEntity = {
        id: deps.newId(),
        kind: "email_message",
        ...(clientRef === undefined ? {} : { clientRef }),
        ...(key === undefined ? {} : { idempotencyKey: key }),
        data: { to, subject, body },
        createdAt: deps.now().toISOString(),
      };
      const stored = await deps.store.create(entity);
      if (stored.id !== entity.id) {
        // Same Idempotency-Key as an earlier call: nothing new was sent.
        return jsonResponse(200, view(stored), { "idempotent-replayed": "true" });
      }
      return jsonResponse(202, view(entity));
    }

    const match = /^\/messages\/([^/]+)$/.exec(req.path);
    if (match?.[1] !== undefined && req.method === "GET") {
      const entity = await deps.store.get("email_message", match[1]);
      return entity ? jsonResponse(200, view(entity)) : notFound();
    }

    return notFound();
  };
}
