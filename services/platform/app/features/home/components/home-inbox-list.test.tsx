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
vi.mock('@/app/features/conversations/hooks/use-inbox-channel-options', () => ({
  useInboxChannelOptions: () => [],
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

function renderInbox() {
  return render(
    <HomeInboxList
      organizationId="org-1"
      status="open"
      onStatusChange={vi.fn()}
      onInboxRoute={false}
    />,
  );
}

const searchBox = () => screen.getByPlaceholderText('Search conversations');
const filterButton = () => screen.getByRole('button', { name: 'Filter' });

beforeEach(() => {
  listing.current = pages([conversation('c1', 'Invoice shows the wrong VAT')]);
});

afterEach(() => {
  window.localStorage.clear();
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

  it('keeps both usable when the channel facet narrowed the status to nothing on the server', () => {
    window.localStorage.setItem(
      'home-inbox-channel-org-1',
      JSON.stringify('gmail'),
    );
    listing.current = pages([]);
    renderInbox();
    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeEnabled();
  });
});
