import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AgentWebhookSection } from './agent-webhook-section';

// Migrated from the `agent-editor` E2E "webhook tab: renders the section and
// create affordance (render-only)". The E2E flagged this tab as render-only on
// purpose: real webhook delivery isn't hermetic, so it asserts the tab's
// primary section heading, the create affordance, and the empty state rather
// than a mutate. None of that needs a backend — with an empty webhook list the
// whole section is pure client-side UI — so it belongs at the component tier.
//
// We mock the webhook query to an empty list (the freshly-created-agent state
// the E2E saw) and the webhook mutations (only touched on create/toggle/delete,
// never at mount), and assert the same three seams: the "Webhooks" section
// heading (h2), the "Create webhook" button, and the "No webhooks yet" empty
// state.

vi.mock('../hooks/queries', () => ({
  useAgentWebhooks: () => ({ webhooks: [], isLoading: false }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateAgentWebhook: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useToggleAgentWebhook: () => ({ mutateAsync: vi.fn() }),
  useDeleteAgentWebhook: () => ({ mutate: vi.fn(), isPending: false }),
}));

// The section reads the site URL from a context provider that the render
// wrapper (AppShell) does not mount; the hook throws without it. Webhook URLs
// are only built per-row, so the value is irrelevant to the render-only asserts
// — stub it to a fixed origin.
vi.mock('@/lib/site-url-context', () => ({
  useSiteUrl: () => 'https://example.test',
}));

// The DataTable inside the section reads the org id from the router; outside a
// RouterProvider that hook throws, so stub it like the other dialog tests.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// Resolved from messages/en.json (settings.agents.webhook.*) — the exact t()
// keys the E2E asserted.
const TITLE = 'Webhooks';
const CREATE_BUTTON = 'Create webhook';
const EMPTY_TITLE = 'No webhooks yet';

// The DataTable's actions column intentionally uses an empty header (header:
// ''), a standard data-table pattern. Disable the empty-table-header rule so we
// still audit every other accessibility concern (matches the other *-table
// component tests).
const axeOptions = {
  rules: { 'empty-table-header': { enabled: false } },
};

describe('AgentWebhookSection', () => {
  it('renders the section heading, create affordance, and empty state', async () => {
    const { container } = render(
      <AgentWebhookSection organizationId="org-1" agentSlug="e2e-editor" />,
    );

    // Primary section heading (SectionHeader defaults to h2 — matches the E2E's
    // `level: 2`).
    expect(
      screen.getByRole('heading', { name: TITLE, level: 2 }),
    ).toBeInTheDocument();

    // The create affordance.
    expect(
      screen.getByRole('button', { name: CREATE_BUTTON }),
    ).toBeInTheDocument();

    // With no webhooks the DataTable renders its empty state — the
    // freshly-created-agent state the E2E observed.
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();

    await checkAccessibility(container, axeOptions);
  });
});
