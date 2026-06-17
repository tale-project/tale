// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { Triggers } from '../triggers/triggers';

// Migrated from automation-editor.spec.ts e2e
// ("triggers tab renders its schedule/webhook/event sections"). The original
// e2e navigated to the /triggers route and asserted the three collapsible
// `<h3>` section headings (schedules / webhooks / events) are visible — a
// render-only assertion about the triggers tab content. We reproduce it by
// rendering the real Triggers component with faithfully-mocked data hooks.

// Triggers data hooks (Convex-backed) — return empty sets (the e2e ran against
// a freshly-created blank automation with no triggers) so the sections render
// their collapsible headers without touching the backend.
vi.mock('../triggers/hooks/queries', () => ({
  useSchedules: () => ({ schedules: [], isLoading: false }),
  useWebhooks: () => ({ webhooks: [], isLoading: false }),
  useEventSubscriptions: () => ({ subscriptions: [], isLoading: false }),
  useWorkflowActivity: () => ({
    hasActiveTrigger: false,
    activeTriggers: 0,
    totalTriggers: 0,
    isLoading: false,
  }),
}));

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({ workflows: [], isLoading: false }),
  useReadWorkflow: () => ({ data: undefined, isLoading: false }),
}));

// Mutations are only invoked by user interactions we don't exercise here; stub
// them so the always-mounted dialogs/menus inside each section mount cleanly.
vi.mock('../triggers/hooks/slug-mutations', () => ({
  useCreateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useUpdateSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSchedule: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useCreateWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteWebhook: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateEventSubscription: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useUpdateEventSubscription: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useToggleEventSubscription: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useDeleteEventSubscription: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('../triggers/hooks/actions', () => ({
  useGenerateCron: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

// DataTable resolves the org id from the router; there is no RouterProvider in
// the test shell, so short-circuit it.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// WebhooksSection reads the site URL from context (no SiteUrlProvider in the
// test shell), so provide a stable host.
vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://example.com',
}));

function renderTriggers() {
  return render(
    <Triggers
      automationId="wf-root-1"
      organizationId="org-1"
      workflowSlug="my-workflow"
    />,
  );
}

describe('Triggers tab', () => {
  it('renders its schedule, webhook, and event sections', () => {
    renderTriggers();

    // Each trigger section header is a collapsible level-3 heading. Their
    // presence proves the triggers tab mounted its primary affordances. The
    // accessible name includes a trailing count badge, so match by substring
    // via a name predicate (mirrors the e2e's non-exact match).
    for (const title of ['Schedules', 'Webhooks', 'Events']) {
      expect(
        screen.getByRole('heading', {
          level: 3,
          name: new RegExp(`^${title}`),
        }),
      ).toBeInTheDocument();
    }
  });

  it('passes an axe audit', async () => {
    const { container } = renderTriggers();
    await checkAccessibility(container);
  });
});
