import { pickFilterOption } from '@tale/ui/testing/filters';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/backend/core/conversations/types';
import { render, screen } from '@/tests/utils/render';

import { Conversations } from './conversations';

// ---------------------------------------------------------------------------
// Regression coverage for #1992: a lane opened via `?search=` seeds the filter
// from the URL param, but clearing the search box must actually clear the
// filter (state is the source of truth — it must NOT fall back to the stale URL
// param on every render).
// ---------------------------------------------------------------------------

// `useNavigate` is called to keep the URL in sync with the search state; in the
// jsdom test there is no router, so a no-op navigate is enough.
const navigateSpy = vi.fn();
vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => navigateSpy,
  useParams: () => ({ id: 'org-1' }),
}));

// The assignee facet resolves ids through two directories and the viewer's own
// membership. Each is a mutable fixture so a test can pose as an admin, as a
// plain member, or as a session whose member context has not landed yet.
const TEAM_NAMES: Record<string, string> = { 'team-billing': 'Billing' };
let myTeams: Array<{ id: string; name: string }> = [];
let isAdmin = true;
let currentUserId: string | undefined = 'user-me';

vi.mock('../hooks/queries', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  // The row names its channel through the connector directory; these tests
  // render without a query provider.
  useMailboxes: () => ({
    mailboxes: [
      {
        id: 'cred-gmail',
        connectorSlug: 'gmail',
        name: 'Gmail',
        status: 'active',
      },
    ],
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useTeams: () => ({ teams: myTeams, isLoading: false }),
  useTeamDirectory: () => ({
    teams: Object.entries(TEAM_NAMES).map(([id, name]) => ({ id, name })),
    isLoading: false,
  }),
  useTeamNames: () => ({
    nameOf: (id: string) => TEAM_NAMES[id],
    isLoading: false,
    teams: Object.entries(TEAM_NAMES).map(([id, name]) => ({ id, name })),
  }),
}));
vi.mock('@/app/features/settings/organization/hooks/queries', () => ({
  useMembers: () => ({
    members: [
      { userId: 'user-me', displayName: 'Zoe A.', email: 'zoe@example.test' },
      {
        userId: 'user-dana',
        displayName: 'Dana K.',
        email: 'dana@example.test',
      },
    ],
    isLoading: false,
  }),
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data:
      currentUserId === undefined
        ? undefined
        : { status: 'ok', userId: currentUserId },
  }),
}));
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => isAdmin }),
}));

// The bulk-actions hook reaches for convex mutations; stub it out so the list
// renders without a backend (mirrors contact-table.test.tsx).
vi.mock('../hooks/use-bulk-actions', () => ({
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

// The reading pane pulls in convex queries/mutations; it is irrelevant to the
// list-filtering behaviour under test, so stub it to a marker.
vi.mock('./conversation-panel', () => ({
  ConversationPanel: () => <div data-testid="conversation-panel" />,
}));

function makeConversation(
  id: string,
  title: string,
  assignment: { assigneeUserId?: string; assigneeTeamId?: string } = {},
): ConversationItem {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the list row only reads id/title/unread_count for this test
  return {
    _id: id,
    id,
    title,
    ...assignment,
    description: '',
    subject: '',
    status: 'open',
    unread_count: 0,
    last_message_at: '2026-01-01T00:00:00.000Z',
    messages: [],
  } as unknown as ConversationItem;
}

function makePaginatedResult(
  results: ConversationItem[],
): UsePaginatedQueryReturnType<ConversationItem> {
  return {
    results,
    status: 'Exhausted',
    isLoading: false,
    loadMore: vi.fn(),
  } as unknown as UsePaginatedQueryReturnType<ConversationItem>;
}

const searchBox = () => screen.getByPlaceholderText('Search conversations');

/** Whether a conversation list row exists (rows are buttons labelled by title). */
function hasConversationRow(title: string): boolean {
  return screen.queryByRole('button', { name: title }) !== null;
}

beforeEach(() => {
  myTeams = [];
  isAdmin = true;
  currentUserId = 'user-me';
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('Conversations', () => {
  it('clears the filter when the search box is emptied after a ?search= seed', async () => {
    const conversations = [
      makeConversation('c1', 'Refund please'),
      makeConversation('c2', 'Order shipped'),
    ];

    const { user } = render(
      <Conversations
        status="open"
        organizationId="test-org-id"
        // Seeded from the `?search=Refund` URL param.
        search="Refund"
        paginatedResult={makePaginatedResult(conversations)}
        conversationCount={conversations.length}
        totalConversationCount={conversations.length}
      />,
    );

    // The seeded filter is applied: only the matching row is visible.
    expect(searchBox()).toHaveValue('Refund');
    expect(hasConversationRow('Refund please')).toBe(true);
    expect(hasConversationRow('Order shipped')).toBe(false);

    // Clearing the box must remove the filter and bring every row back — it
    // must NOT fall back to the stale `search` prop (the #1992 bug). The input
    // is readonly until focused (anti-autofill), so click to focus it first.
    await user.click(searchBox());
    await user.clear(searchBox());
    expect(searchBox()).toHaveValue('');
    expect(hasConversationRow('Refund please')).toBe(true);
    expect(hasConversationRow('Order shipped')).toBe(true);
  });

  describe('assignee facet', () => {
    const claimed = makeConversation('c1', 'Refund please', {
      assigneeUserId: 'user-dana',
    });
    const queued = makeConversation('c2', 'Order shipped', {
      assigneeTeamId: 'team-billing',
    });
    const untouched = makeConversation('c3', 'Where is my parcel');

    function renderInbox(
      props: Partial<Parameters<typeof Conversations>[0]> = {},
    ) {
      const rows = [claimed, queued, untouched];
      return render(
        <Conversations
          status="open"
          organizationId="test-org-id"
          paginatedResult={makePaginatedResult(rows)}
          conversationCount={rows.length}
          totalConversationCount={rows.length}
          {...props}
        />,
      );
    }

    it('puts the filter behind the search box with no visible label', () => {
      renderInbox();

      const filter = screen.getByRole('button', { name: 'Filter' });
      expect(filter).toHaveTextContent('');
      // The queue dropdown that used to sit in front of the search is gone.
      expect(screen.queryByText('All queues')).not.toBeInTheDocument();
      expect(
        searchBox().compareDocumentPosition(filter) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('narrows to one person’s conversations', async () => {
      const onAssigneeFilterChange = vi.fn();
      const { user } = renderInbox({ onAssigneeFilterChange });

      await pickFilterOption(user, 'Assignee', 'Dana K.');

      expect(onAssigneeFilterChange).toHaveBeenCalledWith(['user-dana']);
    });

    it('shows only the selected person’s rows', () => {
      renderInbox({ assigneeFilter: ['user-dana'] });

      expect(hasConversationRow('Refund please')).toBe(true);
      expect(hasConversationRow('Order shipped')).toBe(false);
      expect(hasConversationRow('Where is my parcel')).toBe(false);
    });

    it('separates people from teams inside the one facet', async () => {
      myTeams = [{ id: 'team-billing', name: 'Billing' }];
      const { user } = renderInbox();

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(await screen.findByRole('button', { name: /Assignee/ }));

      expect(screen.getByText('People')).toBeInTheDocument();
      expect(screen.getByText('Teams')).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'Dana K.' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'Billing' }),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('checkbox', { name: 'My teams' }),
      ).toBeInTheDocument();
    });

    it('offers Unassigned to an admin', async () => {
      const { user } = renderInbox();

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(await screen.findByRole('button', { name: /Assignee/ }));

      expect(
        screen.getByRole('checkbox', { name: 'Unassigned' }),
      ).toBeInTheDocument();
    });

    it('withholds Unassigned from a non-admin', async () => {
      // Unassigned rows are administrator triage — the server does not return
      // them to a member, so offering the option would only ever filter to
      // nothing while implying the rows exist.
      isAdmin = false;
      const { user } = renderInbox();

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(await screen.findByRole('button', { name: /Assignee/ }));

      expect(
        screen.queryByRole('checkbox', { name: 'Unassigned' }),
      ).not.toBeInTheDocument();
    });

    it('withholds "Assigned to me" until the member context lands', async () => {
      currentUserId = undefined;
      const { user } = renderInbox();

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(await screen.findByRole('button', { name: /Assignee/ }));

      expect(
        screen.queryByRole('checkbox', { name: 'Assigned to me' }),
      ).not.toBeInTheDocument();
    });

    it('clears the search box along with every facet', async () => {
      const onAssigneeFilterChange = vi.fn();
      const onReadFilterChange = vi.fn();
      const { user } = renderInbox({
        search: 'Refund',
        assigneeFilter: ['user-dana'],
        onAssigneeFilterChange,
        onReadFilterChange,
      });

      await user.click(screen.getByRole('button', { name: 'Filter' }));
      await user.click(
        await screen.findByRole('button', { name: 'Clear all' }),
      );

      expect(onAssigneeFilterChange).toHaveBeenCalledWith([]);
      expect(onReadFilterChange).toHaveBeenCalledWith('all');
      expect(searchBox()).toHaveValue('');
    });
  });
});
