import { createFileRoute, Outlet } from '@tanstack/react-router';

export const Route = createFileRoute(
  '/dashboard/$id/automations/$automationSlug',
)({
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
