// @vitest-environment jsdom
/**
 * Renders the platform Inbox builtin view end-to-end through the registry
 * (`InboxView` → `AutomationView` → Puck `Render` → the real `ConversationList` /
 * `ConversationThread` / `MessageComposer` blocks), mocking ONLY the Convex
 * network layer and router/i18n infrastructure — the same seams as the
 * sibling `registry/tale-config.test.tsx`. Pins:
 *
 *  - the four status tabs render from PLATFORM i18n (`automations.inbox.*`),
 *    opening on Open;
 *  - the blocks mount inside the platform-trusted runtime (never the hosting
 *    bundle's empty allowlist) — the list binds its paginated query;
 *  - the provider scope derives from the manifest's `requires.integrations`
 *    (the query args carry `integrationName`), with zero per-provider config;
 *  - the view is channel-generic: a non-email provider (e.g. WhatsApp) gets
 *    the identical tabs/copy/blocks, scoped to its own `integrationName` —
 *    nothing here hardcodes `gmail`/`outlook`/`imap`.
 */
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Router — effect/navigation hooks used by blocks; no routing is exercised.
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'org-1' }),
  Link: ({ children, ...rest }: { children?: ReactNode }) => (
    <a {...rest}>{children}</a>
  ),
}));

// --- Convex network seams (the ONLY data mocks) -----------------------------
let lastPaginatedArgs: unknown;
vi.mock('@/app/hooks/use-convex-paginated-query', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexPaginatedQuery: (_query: unknown, args: unknown) => {
    lastPaginatedArgs = args;
    return {
      results: [],
      status: 'Exhausted',
      isLoading: false,
      loadMore: vi.fn(),
    };
  },
}));
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: undefined, isLoading: true, error: null }),
}));
vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('convex/react', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  useConvexAuth: () => ({ isAuthenticated: true, isLoading: false }),
}));

// ----------------------------------------------------------------------------
import { render, screen } from '@/tests/utils/render';

import type { AutomationSummary } from '../hooks/use-automations';
import { AutomationRuntimeProvider } from '../runtime/automation-runtime';
import { InboxView } from './inbox-view';

const outlookAutomation: AutomationSummary = {
  slug: 'reply-outlook-emails',
  name: 'Reply to Outlook emails',
  description: '',
  scope: 'org',
  kind: 'automation',
  workflows: [],
  agents: [],
  skills: [],
  // The bundle declares NO functions — the inbox runs on the view's own
  // platform-trusted allowlist, which this test proves by the blocks binding.
  functions: [],
  builtinViews: [{ id: 'inbox' }],
  requiredIntegrations: ['outlook'],
  views: [],
};

// A hypothetical non-email provider — proves the view is channel-generic:
// nothing about it names an email provider, so any automation requiring a
// different integration (WhatsApp, Teams, Telegram, …) gets the same inbox.
const whatsappApp: AutomationSummary = {
  ...outlookAutomation,
  slug: 'whatsapp-inbox',
  name: 'Reply to WhatsApp messages',
  requiredIntegrations: ['whatsapp'],
};

function renderInboxFor(automation: AutomationSummary) {
  return render(
    // The hosting provider automation-page mounts — bundle config is
    // irrelevant to a builtin view, which re-provides a trusted runtime.
    <AutomationRuntimeProvider
      value={{
        organizationId: 'org-1',
        automationSlug: automation.slug,
        allowlist: [],
        config: {},
      }}
    >
      <InboxView automation={automation} />
    </AutomationRuntimeProvider>,
  );
}

function renderInbox() {
  return renderInboxFor(outlookAutomation);
}

beforeEach(() => {
  lastPaginatedArgs = undefined;
});

describe('InboxView (platform builtin view)', () => {
  it('renders the four status tabs from platform i18n, opening on Open', () => {
    renderInbox();
    const open = screen.getByRole('tab', { name: 'Open' });
    expect(open).toHaveAttribute('aria-selected', 'true');
    for (const name of ['Closed', 'Spam', 'Archived']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
  });

  it('mounts the conversation blocks on the trusted allowlist (list + thread render)', () => {
    renderInbox();
    // ConversationList reached its bound query (not the blocked notice) and
    // shows the localized empty state for the Open tab.
    expect(screen.getByText('No open conversations')).toBeInTheDocument();
    // ConversationThread awaits a selection with the localized placeholder.
    expect(
      screen.getByText('Select a conversation to view details'),
    ).toBeInTheDocument();
  });

  it("scopes every query to the manifest's required integration", () => {
    renderInbox();
    expect(lastPaginatedArgs).toEqual({
      organizationId: 'org-1',
      status: 'open',
      integrationName: 'outlook',
    });
  });

  it('renders the identical channel-neutral inbox for a non-email provider', () => {
    renderInboxFor(whatsappApp);
    // Same generic tabs — nothing here special-cases an email provider.
    expect(screen.getByRole('tab', { name: 'Open' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    for (const name of ['Closed', 'Spam', 'Archived']) {
      expect(screen.getByRole('tab', { name })).toBeInTheDocument();
    }
    // The query scopes to WHATEVER integration the manifest requires — never
    // a hardcoded gmail/outlook/imap provider.
    expect(lastPaginatedArgs).toEqual({
      organizationId: 'org-1',
      status: 'open',
      integrationName: 'whatsapp',
    });
  });
});
