import { z } from "zod";
import type { ProviderDeps } from "./deps.js";
import { jsonResponse, type MockHandler, type MockResponse } from "./http.js";
import type { MockEntity } from "./state.js";

/**
 * Calendar: plain REST + JSON, errors as `{ error: { code, message } }` with real HTTP statuses.
 * Supports lookup by clientRef, so a caller can check whether a create already happened.
 */
const CreateEvent = z.object({
  title: z.string().min(1),
  start: z.iso.datetime(),
  end: z.iso.datetime(),
  clientRef: z.string().min(1).optional(),
});

const error = (status: number, code: string, message: string): MockResponse =>
  jsonResponse(status, { error: { code, message } });

const view = (e: MockEntity) => ({
  id: e.id,
  ...e.data,
  ...(e.clientRef === undefined ? {} : { clientRef: e.clientRef }),
  createdAt: e.createdAt,
});

export function createCalendarHandler(deps: ProviderDeps): MockHandler {
  return async (req) => {
    if (req.path === "/events") {
      if (req.method === "POST") {
        let raw: unknown;
        try {
          raw = JSON.parse(req.body);
        } catch {
          return error(400, "invalid_json", "Request body is not valid JSON");
        }
        const parsed = CreateEvent.safeParse(raw);
        if (!parsed.success) {
          return error(400, "invalid_argument", parsed.error.issues[0]?.message ?? "Invalid body");
        }
        const { title, start, end, clientRef } = parsed.data;
        if (Date.parse(end) <= Date.parse(start)) {
          return error(400, "invalid_argument", "end must be after start");
        }
        const entity: MockEntity = {
          id: deps.newId(),
          kind: "calendar_event",
          ...(clientRef === undefined ? {} : { clientRef }),
          data: { title, start, end },
          createdAt: deps.now().toISOString(),
        };
        await deps.store.create(entity);
        return jsonResponse(201, view(entity));
      }
      if (req.method === "GET") {
        const clientRef = req.query.get("clientRef");
        if (!clientRef) {
          return error(400, "invalid_argument", "clientRef query parameter is required");
        }
        const found = await deps.store.findByClientRef("calendar_event", clientRef);
        return jsonResponse(200, { items: found.map(view) });
      }
      return error(405, "method_not_allowed", `${req.method} is not allowed on /events`);
    }

    const match = /^\/events\/([^/]+)$/.exec(req.path);
    if (match?.[1] !== undefined) {
      if (req.method !== "GET") {
        return error(405, "method_not_allowed", `${req.method} is not allowed on /events/{id}`);
      }
      const entity = await deps.store.get("calendar_event", match[1]);
      return entity ? jsonResponse(200, view(entity)) : error(404, "not_found", "Event not found");
    }

    return error(404, "not_found", "Unknown path");
  };
}
