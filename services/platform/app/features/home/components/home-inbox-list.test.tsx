import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { render, screen } from '@/tests/utils/render';

import { HomeInboxList } from './home-inbox-list';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    search: _search,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params?: unknown;
    search?: unknown;
  } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-current-user', () => ({
  useCurrentUser: () => ({ data: { userId: 'user-me' } }),
}));

// The one read the view is made of, steered per test: the loaded pages of the
// status on show.
const listing = vi.hoisted(() => ({
  current: null as unknown as UsePaginatedQueryReturnType<ConversationItem>,
}));
vi.mock(
  '@/app/features/conversations/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<Record<string, unknown>>()),
    useListConversationsPaginated: () => listing.current,
  }),
);
// The connected providers the Channel facet offers; none unless a test says.
const channels = vi.hoisted(() => ({
  current: [] as { value: string; label: string }[],
}));
vi.mock('@/app/features/conversations/hooks/use-inbox-channel-options', () => ({
  useInboxChannelOptions: () => channels.current,
}));

// The assignee facet's directories and the viewer's membership.
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: [], isLoading: false }),
  useTeamNames: () => ({ nameOf: () => undefined, isLoading: false }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({ members: [], isLoading: false }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { status: 'ok', userId: 'user-me' },
  }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));
vi.mock('@/app/features/conversations/hooks/use-bulk-actions', () => ({
  useBulkActions: () => ({
    isBulkProcessing: false,
    bulkSendDialog: { isOpen: false, isSending: false },
    openBulkSendDialog: vi.fn(),
    closeBulkSendDialog: vi.fn(),
    handleSendMessages: vi.fn(),
    handleBulkResolve: vi.fn(),
    handleBulkReopen: vi.fn(),
    handleBulkSpam: vi.fn(),
    handleBulkArchive: vi.fn(),
    handleBulkUnarchive: vi.fn(),
  }),
}));

function conversation(id: string, title: string): ConversationItem {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the Home row reads id, title, status, unread count and the last message time
  return {
    _id: id,
    _creationTime: Date.now(),
    id,
    title,
    description: '',
    subject: '',
    status: 'open',
    unread_count: 0,
    last_message_at: new Date().toISOString(),
    messages: [],
  } as unknown as ConversationItem;
}

function pages(
  results: ConversationItem[],
  status: UsePaginatedQueryReturnType<ConversationItem>['status'] = 'Exhausted',
): UsePaginatedQueryReturnType<ConversationItem> {
  return {
    results,
    status,
    isLoading: status === 'LoadingFirstPage',
    loadMore: vi.fn(),
    error: null,
    retry: vi.fn(),
  };
}

const inbox = () => (
  <HomeInboxList
    organizationId="org-1"
    status="open"
    onStatusChange={vi.fn()}
    onInboxRoute={false}
  />
);

function renderInbox() {
  return render(inbox());
}

const searchBox = () => screen.getByPlaceholderText('Search conversations');
const filterButton = () => screen.getByRole('button', { name: 'Filter' });

beforeEach(() => {
  listing.current = pages([conversation('c1', 'Invoice shows the wrong VAT')]);
});

afterEach(() => {
  window.localStorage.clear();
  channels.current = [];
});

describe('HomeInboxList search and filters', () => {
  it('offers both over a status that holds conversations', () => {
    renderInbox();
    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeEnabled();
  });

  it('disables both over a status with no conversation and nothing narrowing it', () => {
    listing.current = pages([]);
    renderInbox();
    expect(screen.getByText('No conversations')).toBeInTheDocument();
    expect(searchBox()).toBeDisabled();
    expect(filterButton()).toBeDisabled();
  });

  it('holds both while the first page loads', () => {
    listing.current = pages([], 'LoadingFirstPage');
    renderInbox();
    expect(searchBox()).toBeDisabled();
    expect(filterButton()).toBeDisabled();
  });

  it('holds both while the first page loads, even under a remembered facet', () => {
    // A facet alone would keep them usable over an empty status; the first
    // page still loading is what holds them here.
    window.localStorage.setItem(
      'home-inbox-read-org-1',
      JSON.stringify('unread'),
    );
    listing.current = pages([], 'LoadingFirstPage');
    renderInbox();
    expect(searchBox()).toBeDisabled();
    expect(filterButton()).toBeDisabled();
  });

  it('keeps both usable when the status failed to load, since its conversations are unknown', () => {
    listing.current = {
      ...pages([]),
      error: new Error('Request timed out'),
    };
    renderInbox();
    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeEnabled();
  });

  it('keeps both usable when a remembered facet narrowed the status to nothing, until it is cleared', async () => {
    // The read facet is remembered per device — this status came back empty
    // under "Unread" alone, so the facet has to stay reachable to undo.
    window.localStorage.setItem(
      'home-inbox-read-org-1',
      JSON.stringify('unread'),
    );
    listing.current = pages([]);
    const { user } = renderInbox();

    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeEnabled();

    await user.click(filterButton());
    await user.click(await screen.findByRole('button', { name: 'Clear all' }));

    // Nothing narrows the empty status any more: nothing left to search.
    expect(filterButton()).toBeDisabled();
    expect(searchBox()).toBeDisabled();
  });

  it('keeps the Filter panel open when unticking the last facet disables it, and does not reopen it once closed', async () => {
    window.localStorage.setItem(
      'home-inbox-read-org-1',
      JSON.stringify('unread'),
    );
    listing.current = pages([]);
    const { user, rerender } = renderInbox();

    // Undo the facet from inside the panel instead of pressing Clear all.
    await user.click(filterButton());
    await user.click(
      await screen.findByRole('button', {
        name: (name) => name.startsWith('Read status'),
      }),
    );
    await user.click(screen.getByRole('radio', { name: 'All' }));

    // Nothing narrows the empty status now, but the panel is not pulled from
    // under the reader: it stays open, focus with it, until they close it.
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'All' })).toHaveFocus();
    expect(searchBox()).toBeDisabled();

    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(filterButton()).toBeDisabled();

    // A conversation lands live: the controls come back, the panel stays shut.
    listing.current = pages([
      conversation('c1', 'Invoice shows the wrong VAT'),
    ]);
    rerender(inbox());
    expect(filterButton()).toBeEnabled();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the Filter panel open while a channel pick sends the list back to its first page', async () => {
    channels.current = [{ value: 'gmail', label: 'Gmail' }];
    const { user, rerender } = renderInbox();

    await user.click(filterButton());
    await user.click(await screen.findByRole('button', { name: 'Channel' }));
    // The channel narrows on the server: the pick starts a fresh first page.
    listing.current = pages([], 'LoadingFirstPage');
    await user.click(screen.getByRole('radio', { name: 'Gmail' }));

    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(searchBox()).toBeDisabled();

    listing.current = pages([conversation('c2', 'Gmail thread')]);
    rerender(inbox());
    expect(screen.getByRole('dialog', { name: 'Filters' })).toBeInTheDocument();
    expect(searchBox()).toBeEnabled();
  });

  it('keeps both usable when the channel facet narrowed the status to nothing on the server, until it is cleared', async () => {
    channels.current = [{ value: 'gmail', label: 'Gmail' }];
    window.localStorage.setItem(
      'home-inbox-channel-org-1',
      JSON.stringify('gmail'),
    );
    listing.current = pages([]);
    const { user } = renderInbox();
    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeEnabled();

    // The panel offers the channel facet as picked, so it can be undone.
    await user.click(filterButton());
    await user.click(
      await screen.findByRole('button', {
        name: (name) => name.startsWith('Channel'),
      }),
    );
    expect(screen.getByRole('radio', { name: 'Gmail' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('button', { name: 'Clear all' }));

    expect(filterButton()).toBeDisabled();
    expect(searchBox()).toBeDisabled();
  });
});
