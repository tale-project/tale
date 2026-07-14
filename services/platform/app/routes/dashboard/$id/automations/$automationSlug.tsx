import { createFileRoute, Outlet } from '@tanstack/react-router';

import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '@/lib/shared/schemas/automations';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug',
)({
  // An automation slug is a PATH (`gmail/sync-emails`) but a route param is ONE
  // segment, so it travels the URL `__`-encoded. Declaring the codec on the route
  // that OWNS the param means every link to this route or any of its children is
  // encoded by the router, and every `useParams()` below it reads the real slug —
  // no call site has to remember (the router applies these across the whole
  // matched-route chain).
  params: {
    parse: (raw: { automationSlug: string }) => ({
      automationSlug: paramToAutomationSlug(raw.automationSlug),
    }),
    stringify: (parsed: { automationSlug: string }) => ({
      automationSlug: automationSlugToParam(parsed.automationSlug),
    }),
  },
  component: AutomationLayout,
});

/**
 * Layout for an automation + its nested run-detail page
 * (`/automations/$automationSlug/runs/$executionId`). The automation itself renders
 * at the index child; nested routes render through the Outlet — which keeps
 * run-watching INSIDE the automation shell instead of bouncing out to the
 * global workflow operator route. (Index-child pattern, like
 * `agents/$agentId` — no pathname compare, so it's robust to any URL-encoded
 * slug.)
 *
 * Every child owns its full page shell (`AutomationDetailShell` — breadcrumb
 * + tab strip + `PageLayout`), so this layout only forwards; the flex column
 * keeps the Editor tab's `flex-1 min-h-0` chain intact so the canvas fills
 * the page.
 */
function AutomationLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}
