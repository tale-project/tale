import { afterEach, describe, expect, it, vi } from 'vitest';

import type { UsePaginatedQueryReturnType } from '@/app/hooks/use-cached-paginated-query';
import type { ConversationItem } from '@/convex/conversations/types';
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

function makeConversation(id: string, title: string): ConversationItem {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal fixture; the list row only reads id/title/unread_count for this test
  return {
    _id: id,
    id,
    title,
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
});
