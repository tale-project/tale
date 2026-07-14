import { createFileRoute, Outlet } from '@tanstack/react-router';

import {
  automationSlugToParam,
  paramToAutomationSlug,
} from '@/lib/shared/schemas/automations';

export const Route = createFileRoute(
  '/dashboard/$id/projects/$projectId/automations/$automationSlug',
)({
  // Same `__`-encoded path slug as the org-level automation route — see
  // `automations/$automationSlug.tsx`.
  params: {
    parse: (raw: { automationSlug: string }) => ({
      automationSlug: paramToAutomationSlug(raw.automationSlug),
    }),
    stringify: (parsed: { automationSlug: string }) => ({
      automationSlug: automationSlugToParam(parsed.automationSlug),
    }),
  },
  component: ProjectAutomationLayout,
});

/**
 * Layout for a project-scoped automation + its nested run-detail page, rendered INSIDE
 * the project shell (the project's tab strip stays visible, the automation's tab
 * active). The automation renders at the index child; `/runs/$executionId` renders
 * through the Outlet so run-watching stays in-context. Mirrors the org-level
 * `automations/$automationSlug` layout, one level deeper under the project.
 *
 * A flex column (not a plain block div) so the index route's Editor tab can
 * chain `flex-1 min-h-0` up to the project shell's `PageLayout` and have the
 * workflow canvas fill the available height; every other tab renders at its
 * natural height inside this same box.
 *
 * No padding here: `AutomationPage` pads each tab itself (its `ContentArea`
 * wrappers), exactly like the org-level layout — an extra `p-4` would double
 * every tab's padding (view/desk tabs, Configuration, Triggers, …).
 */
function ProjectAutomationLayout() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <Outlet />
    </div>
  );
}
