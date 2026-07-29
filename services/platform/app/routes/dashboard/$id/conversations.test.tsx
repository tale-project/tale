// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

// ---------------------------------------------------------------------------
// Regression coverage for #2641: a contact-row "New email" action lands on
// `/conversations/open?compose=new&composeContact=<id>`. When the org has no
// mailbox connected, the layout used to render the generic "Set up your
// Inbox" empty state and silently drop the compose params — no acknowledgement
// of which contact the user tried to email, and the intent was lost even
// after they installed a mailbox. The layout now (1) names the contact in a
// contextual notice on that same empty state and (2) stashes the intent so it
// resumes once a mailbox exists.
// ---------------------------------------------------------------------------

const { mockUseParams, mockNavigate } = vi.hoisted(() => ({
  mockUseParams: () => ({ id: 'org-1' }),
  mockNavigate: vi.fn(),
}));

let mockSearch: Record<string, unknown> = {};
let mockChildParams: Record<string, unknown> = { status: 'open' };

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  Outlet: () => <div data-testid="outlet" />,
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
  redirect: vi.fn(),
  useNavigate: () => mockNavigate,
  useParams: () => mockChildParams,
  useSearch: () => mockSearch,
  // `PageLayout` wraps its children in `LayoutErrorBoundary`, which reads the
  // current pathname purely for a support link — a fixed value is fine here.
  useLocation: () => ({ pathname: '/dashboard/org-1/conversations/open' }),
}));

let mockInboxAvailability: { isLoading: boolean; hasInbox: boolean } = {
  isLoading: false,
  hasInbox: false,
};
vi.mock('@/app/features/conversations/hooks/use-inbox-availability', () => ({
  useInboxAvailability: () => mockInboxAvailability,
}));

let mockComposeContactName: { name: string | undefined; isLoading: boolean } = {
  name: undefined,
  isLoading: false,
};
vi.mock('@/app/features/conversations/hooks/queries', () => ({
  useComposeContactName: (
    _organizationId: string,
    contactId: string | undefined,
  ) =>
    contactId ? mockComposeContactName : { name: undefined, isLoading: false },
}));

vi.mock('@/app/hooks/use-convex-auth', () => ({
  useAuth: () => ({ user: { userId: 'user-1' } }),
}));

// The real `AdaptiveHeaderRoot`/`Title` require an `AdaptiveHeaderProvider`
// ancestor (mounted by the dashboard shell in production); stub them to plain
// passthroughs so this route-level test doesn't need the whole shell.
vi.mock('@/app/components/layout/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  AdaptiveHeaderTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock(
  '@/app/features/conversations/components/conversations-navigation',
  () => ({
    ConversationsNavigation: ({
      action,
    }: {
      organizationId: string;
      action?: React.ReactNode;
    }) => <div data-testid="conversations-navigation">{action}</div>,
  }),
);

// `usePersistedState` is left un-mocked: the resume-across-setup behaviour
// (#2641 AC2) is exactly a localStorage round trip, so the test proves it
// against the real implementation.

import { Route } from './conversations';

// The router mock above replaces `createFileRoute`, so `Route` is the plain
// config object (component included); the real Route type doesn't expose it.
const ConversationsLayout = (
  Route as unknown as { component: () => React.ReactElement }
).component;

const pendingComposeKey = 'conversations-pending-compose-user-1-org-1';

beforeEach(() => {
  window.localStorage.clear();
  mockSearch = {};
  mockChildParams = { status: 'open' };
  mockInboxAvailability = { isLoading: false, hasInbox: false };
  mockComposeContactName = { name: undefined, isLoading: false };
  mockNavigate.mockClear();
});

afterEach(() => {
  cleanup();
});

describe('ConversationsLayout', () => {
  it('shows the generic setup notice when there is no compose intent', () => {
    render(<ConversationsLayout />);

    expect(
      screen.getByRole('heading', { name: 'Set up your Inbox' }),
    ).toBeInTheDocument();
    expect(screen.getByText(/Install an email automation/)).toBeInTheDocument();
    expect(
      screen.queryByText(/first install an email automation\./),
    ).not.toBeInTheDocument();
  });

  it('names the contact instead of silently dropping the compose intent', () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    mockComposeContactName = { name: 'Ada Lovelace', isLoading: false };

    render(<ConversationsLayout />);

    // The setup empty state is kept (never a silent no-op)...
    expect(
      screen.getByRole('heading', { name: 'Set up your Inbox' }),
    ).toBeInTheDocument();
    // ...with a contact-specific notice added alongside it.
    expect(
      screen.getByText(
        'To email Ada Lovelace, first install an email automation.',
      ),
    ).toBeInTheDocument();
    // The "Browse automations" escape hatch is still offered.
    expect(
      screen.getByRole('link', { name: 'Browse automations' }),
    ).toBeInTheDocument();
  });

  it('falls back to a generic contact label while the contact is still loading', () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    mockComposeContactName = { name: undefined, isLoading: true };

    render(<ConversationsLayout />);

    // No flash of "Unknown contact" while the lookup is in flight — only the
    // base description shows until the name (or its absence) is settled.
    expect(
      screen.queryByText(/first install an email automation\./),
    ).not.toBeInTheDocument();
  });

  it('falls back to "Unknown contact" once resolved and the contact is gone', () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    mockComposeContactName = { name: undefined, isLoading: false };

    render(<ConversationsLayout />);

    expect(
      screen.getByText(
        'To email Unknown contact, first install an email automation.',
      ),
    ).toBeInTheDocument();
  });

  it('stashes the compose intent to localStorage so it survives mailbox setup', () => {
    mockSearch = { compose: 'new', composeContact: 'contact-1' };

    render(<ConversationsLayout />);

    const stored = window.localStorage.getItem(pendingComposeKey);
    expect(stored).not.toBeNull();
    expect(JSON.parse(stored ?? '{}')).toEqual({
      compose: 'new',
      composeContact: 'contact-1',
    });
  });

  it('resumes a stashed compose intent once a mailbox exists, then forgets it', () => {
    // First load: no mailbox yet, compose params arrive and get stashed.
    mockSearch = { compose: 'new', composeContact: 'contact-1' };
    render(<ConversationsLayout />);
    expect(window.localStorage.getItem(pendingComposeKey)).not.toBeNull();
    cleanup();

    // The user installs a mailbox elsewhere, then returns to a bare Inbox
    // URL (no compose params) — the child route never carried them.
    mockSearch = {};
    mockInboxAvailability = { isLoading: false, hasInbox: true };
    render(<ConversationsLayout />);

    expect(mockNavigate).toHaveBeenCalledTimes(1);
    const call = mockNavigate.mock.calls[0][0] as {
      to: string;
      params: Record<string, unknown>;
      search: (prev: Record<string, unknown>) => Record<string, unknown>;
      replace: boolean;
    };
    expect(call.to).toBe('/dashboard/$id/conversations/$status');
    expect(call.params).toEqual({ id: 'org-1', status: 'open' });
    expect(call.replace).toBe(true);
    expect(call.search({})).toEqual({
      compose: 'new',
      composeContact: 'contact-1',
    });

    // One-shot: the stash is cleared so a later visit doesn't reopen it again.
    expect(window.localStorage.getItem(pendingComposeKey)).toBeNull();
  });

  it('shows the Compose action when the inbox list is open', () => {
    mockInboxAvailability = { isLoading: false, hasInbox: true };
    render(<ConversationsLayout />);

    expect(screen.getByRole('button', { name: 'Compose' })).toBeInTheDocument();
  });

  it('hides the Compose action while composing', () => {
    mockInboxAvailability = { isLoading: false, hasInbox: true };
    mockSearch = { compose: 'new' };
    render(<ConversationsLayout />);

    expect(
      screen.queryByRole('button', { name: 'Compose' }),
    ).not.toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with the contact-specific notice shown', async () => {
      mockSearch = { compose: 'new', composeContact: 'contact-1' };
      mockComposeContactName = { name: 'Ada Lovelace', isLoading: false };

      const { container } = render(<ConversationsLayout />);
      await checkAccessibility(container);
    });
  });
});
