import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { AgentWebhook } from '../hooks/queries';
import { AgentWebhookSection } from './agent-webhook-section';

// Migrated from the `agent-editor` E2E "webhook tab: renders the section and
// create affordance (render-only)". The E2E flagged this tab as render-only on
// purpose: real webhook delivery isn't hermetic, so it asserts the tab's
// primary section heading, the create affordance, and the empty state rather
// than a mutate. None of that needs a backend — with an empty webhook list the
// whole section is pure client-side UI — so it belongs at the component tier.
//
// We mock the webhook query (a mutable list so a test can seed a row), and the
// webhook mutations (only touched on create/toggle/delete, never at mount).

let mockWebhooks: AgentWebhook[] = [];

vi.mock('../hooks/queries', () => ({
  useAgentWebhooks: () => ({ webhooks: mockWebhooks, isLoading: false }),
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
const DESCRIPTION =
  'Create unique URLs to chat with this agent from external systems.';
const CREATE_BUTTON = 'Create webhook';
const EMPTY_TITLE = 'No webhooks yet';
const COPY_URL = 'Copy webhook URL';

// The DataTable's actions column intentionally uses an empty header (header:
// ''), a standard data-table pattern. Disable the empty-table-header rule so we
// still audit every other accessibility concern (matches the other *-table
// component tests).
const axeOptions = {
  rules: { 'empty-table-header': { enabled: false } },
};

function webhookRow(overrides: Partial<AgentWebhook> = {}): AgentWebhook {
  return {
    _id: 'wh-1',
    token: 'tok-abc',
    isActive: true,
    lastTriggeredAt: undefined,
    ...overrides,
  } as AgentWebhook;
}

afterEach(() => {
  mockWebhooks = [];
});

describe('AgentWebhookSection', () => {
  it('renders the description lead-in, create affordance, and empty state', async () => {
    const { container } = render(
      <AgentWebhookSection organizationId="org-1" agentSlug="e2e-editor" />,
    );

    // No tab-level heading — the tab strip names the tab (settings
    // no-page-title rule); the description leads the content instead.
    expect(
      screen.queryByRole('heading', { name: TITLE, level: 2 }),
    ).not.toBeInTheDocument();
    expect(screen.getByText(DESCRIPTION)).toBeInTheDocument();

    // The create affordance.
    expect(
      screen.getByRole('button', { name: CREATE_BUTTON }),
    ).toBeInTheDocument();

    // With no webhooks the DataTable renders its empty state — the
    // freshly-created-agent state the E2E observed.
    expect(screen.getByText(EMPTY_TITLE)).toBeInTheDocument();

    await checkAccessibility(container, axeOptions);
  });

  // Regression for #2353: a denied clipboard write used to be swallowed by a
  // comment-only catch, so the user believed the URL was copied. The shared
  // `useCopy` hook now logs the failure (and shows a destructive toast); assert
  // the failure surfaces and the row is NOT flipped to its "copied" state.
  describe('copy webhook URL', () => {
    beforeEach(() => {
      mockWebhooks = [webhookRow()];
    });

    it('surfaces a denied clipboard write instead of swallowing it', async () => {
      const errorSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);

      render(
        <AgentWebhookSection organizationId="org-1" agentSlug="e2e-editor" />,
      );

      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockRejectedValue(new Error('clipboard denied'));

      const copyButton = screen.getByRole('button', { name: COPY_URL });
      fireEvent.click(copyButton);

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledTimes(1);
      });

      // The failure is logged, not swallowed by a comment-only catch.
      await waitFor(() => {
        expect(errorSpy).toHaveBeenCalledWith(
          'Copy to clipboard failed:',
          expect.any(Error),
        );
      });

      // The button never flips to its transient "copied" check on failure.
      expect(copyButton.querySelector('.text-green-500')).toBeNull();
    });

    it('copies the webhook URL on success', async () => {
      render(
        <AgentWebhookSection organizationId="org-1" agentSlug="e2e-editor" />,
      );

      const writeText = vi
        .spyOn(navigator.clipboard, 'writeText')
        .mockResolvedValue(undefined);

      fireEvent.click(screen.getByRole('button', { name: COPY_URL }));

      await waitFor(() => {
        expect(writeText).toHaveBeenCalledWith(
          'https://example.test/api/agents/wh/tok-abc',
        );
      });
    });
  });
});
