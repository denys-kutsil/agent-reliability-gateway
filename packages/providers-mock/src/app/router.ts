import { createCalendarHandler } from "../providers/calendar.js";
import { createCrmHandler } from "../providers/crm.js";
import type { ProviderDeps } from "./deps.js";
import { createEmailHandler } from "../providers/email.js";
import { withFaults, type FaultOptions } from "../faults/faults.js";
import { jsonResponse, type MockHandler } from "../transport/http.js";

/** One entry point for all three providers: /calendar/*, /email/*, /crm/*. */
export function createMockApp(deps: ProviderDeps, faults?: FaultOptions): MockHandler {
  const app = createRoutes(deps);
  return faults ? withFaults(app, faults) : app;
}

function createRoutes(deps: ProviderDeps): MockHandler {
  const routes: [string, MockHandler][] = [
    ["/calendar", createCalendarHandler(deps)],
    ["/email", createEmailHandler(deps)],
    ["/crm", createCrmHandler(deps)],
  ];

  return (req) => {
    for (const [prefix, handler] of routes) {
      if (req.path === prefix || req.path.startsWith(`${prefix}/`)) {
        return handler({ ...req, path: req.path.slice(prefix.length) || "/" });
      }
    }
    return Promise.resolve(jsonResponse(404, { error: "unknown provider" }));
  };
}
