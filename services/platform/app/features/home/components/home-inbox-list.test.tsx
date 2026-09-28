import type React from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { render, screen, waitFor } from '@/tests/utils/render';

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

    // Nothing narrows the empty status any more: nothing left to search. The
    // Filter button takes back the focus the panel held, as unavailable, and
    // leaves the tab order once the reader moves on.
    expect(searchBox()).toBeDisabled();
    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(filterButton()).toHaveAttribute('aria-disabled', 'true');
    await user.tab();
    expect(filterButton()).toBeDisabled();
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

    // Closed, it hands the focus back to the button, now unavailable.
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(filterButton()).toHaveAttribute('aria-disabled', 'true');

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

    expect(searchBox()).toBeDisabled();
    await waitFor(() => expect(filterButton()).toHaveFocus());
    expect(filterButton()).toHaveAttribute('aria-disabled', 'true');
    await user.tab();
    expect(filterButton()).toBeDisabled();
  });

  it('keeps the search box editable while its query is erased over a status that emptied', async () => {
    const { user, rerender } = renderInbox();
    await user.type(searchBox(), 'zz');
    // The status empties under the query: its last conversation was closed
    // elsewhere. The query alone keeps the controls usable now.
    listing.current = pages([]);
    rerender(inbox());

    // Erasing it leaves nothing to search, but not while the reader is in the
    // box: it keeps their focus and their next keystrokes.
    await user.keyboard('{Backspace}{Backspace}');
    expect(searchBox()).toHaveFocus();
    expect(searchBox()).toBeEnabled();
    expect(filterButton()).toBeDisabled();
    await user.keyboard('abc');
    expect(searchBox()).toHaveValue('abc');
    expect(filterButton()).toBeEnabled();
  });
});

/**
 * The toolbar's Select all reads the selection in three states, as the phone
 * list's does: nothing, some, or every row the list shows. It coerced the
 * partial state to "checked", so one ticked row read as all of them, and the
 * next click cleared the row instead of selecting the rest (#3734).
 */
describe('HomeInboxList select all', () => {
  const rows = [
    conversation('c1', 'Invoice shows the wrong VAT'),
    conversation('c2', 'Invoice for March missing'),
    conversation('c3', 'Delivery is late'),
  ];
  const rowBoxes = () =>
    screen.getAllByRole('checkbox', { name: 'Select conversation' });
  const selectAll = () => screen.getByRole('checkbox', { name: 'Select all' });
  const toolbar = () => screen.getByRole('toolbar');

  beforeEach(() => {
    listing.current = pages(rows);
  });

  it('reads mixed over a partial selection, and ticking it selects the rest', async () => {
    const { user } = renderInbox();
    await user.click(rowBoxes()[0]!);

    expect(toolbar()).toHaveAccessibleName('1 selected');
    expect(selectAll()).toHaveAttribute('aria-checked', 'mixed');

    await user.click(selectAll());
    expect(toolbar()).toHaveAccessibleName('3 selected');
    expect(selectAll()).toHaveAttribute('aria-checked', 'true');
    for (const box of rowBoxes()) {
      expect(box).toHaveAttribute('aria-checked', 'true');
    }

    // Ticked while every row is selected, it lets go of all of them.
    await user.click(selectAll());
    expect(screen.queryByRole('toolbar')).not.toBeInTheDocument();
    for (const box of rowBoxes()) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
  });

  it('reads checked once each row is ticked by hand', async () => {
    const { user } = renderInbox();
    for (const box of rowBoxes()) await user.click(box);

    expect(toolbar()).toHaveAccessibleName('3 selected');
    expect(selectAll()).toHaveAttribute('aria-checked', 'true');
  });

  it('counts and selects only the rows a search leaves', async () => {
    const { user } = renderInbox();
    await user.type(searchBox(), 'Invoice');
    expect(rowBoxes()).toHaveLength(2);

    await user.click(rowBoxes()[0]!);
    expect(selectAll()).toHaveAttribute('aria-checked', 'mixed');
    await user.click(selectAll());
    expect(toolbar()).toHaveAccessibleName('2 selected');

    // The row the search hid was never selected.
    await user.click(screen.getByRole('button', { name: 'Clear selection' }));
    await user.type(searchBox(), '{Backspace>7/}');
    expect(rowBoxes()).toHaveLength(3);
    for (const box of rowBoxes()) {
      expect(box).toHaveAttribute('aria-checked', 'false');
    }
  });
});

/**
 * A read that failed once its retries gave up is not an empty status: the
 * view says the list did not load and offers **Try again**, where it used to
 * read **No conversations** with nothing to recover from (#3709). Rows that
 * did load stay on screen.
 */
describe('HomeInboxList read failure', () => {
  const failed = (
    results: ConversationItem[] = [],
    status: UsePaginatedQueryReturnType<ConversationItem>['status'] = 'Exhausted',
  ) => ({
    ...pages(results, status),
    error: new Error('Request failed with status 503'),
  });

  it('says the list did not load, instead of that the status is empty', async () => {
    listing.current = failed();
    const { user } = renderInbox();

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load conversations",
    );
    expect(screen.queryByText('No conversations')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(listing.current.retry).toHaveBeenCalledTimes(1);
  });

  it('keeps the rows that loaded when a later read fails', () => {
    listing.current = failed([
      conversation('c1', 'Invoice shows the wrong VAT'),
    ]);
    renderInbox();

    expect(
      screen.getByRole('link', { name: /Invoice shows the wrong VAT/ }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says so too when a facet had narrowed the loaded rows to none and the next page failed', () => {
    window.localStorage.setItem(
      'home-inbox-read-org-1',
      JSON.stringify('unread'),
    );
    listing.current = failed(
      [conversation('c1', 'Invoice shows the wrong VAT')],
      'CanLoadMore',
    );
    renderInbox();

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load conversations",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    // The facet that narrowed the list stays undoable.
    expect(filterButton()).toBeEnabled();
  });
});
