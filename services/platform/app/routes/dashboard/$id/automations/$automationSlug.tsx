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
 * A flex column (not a plain block div) so the index route's Editor tab can
 * chain `flex-1 min-h-0` up to the parent `automations.tsx` layout's
 * `PageLayout` and have the workflow canvas fill the available height instead
 * of collapsing to its own (empty) content height; every other tab just
 * renders at its natural height inside this same box, and the ancestor
 * `PageLayout` still scrolls if content overflows.
 */
function AutomationLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col p-4">
      <Outlet />
    </div>
  );
}
