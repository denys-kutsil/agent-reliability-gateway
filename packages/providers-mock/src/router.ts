import { createCalendarHandler } from "./calendar.js";
import { createCrmHandler } from "./crm.js";
import type { ProviderDeps } from "./deps.js";
import { createEmailHandler } from "./email.js";
import { jsonResponse, type MockHandler } from "./http.js";

/** One entry point for all three providers: /calendar/*, /email/*, /crm/*. */
export function createMockApp(deps: ProviderDeps): MockHandler {
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
