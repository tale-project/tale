// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { RecentFeedbackTable } from './recent-feedback-table';

const query = vi.hoisted(() => vi.fn());
vi.mock('@/app/hooks/use-backend-query', () => ({ useBackendQuery: query }));

const row = {
  _id: 'feedback-1',
  threadId: 'thread-1',
  messageId: 'message-1',
  userId: 'user-1',
  userDisplayName: 'Ada',
  rating: 'positive' as const,
  comment: `${'preview '.repeat(62)}…`,
  agentSlug: 'support',
  model: 'model',
  provider: 'provider',
  arenaVerdict: null,
  arenaModelA: null,
  arenaModelB: null,
  isArena: false,
  createdAt: 1,
};

afterEach(() => {
  query.mockReset();
});

describe('RecentFeedbackTable', () => {
  it('fetches and renders the full comment when the row expands', async () => {
    query.mockReturnValue({
      data: { comment: `${row.comment} accepted explanation ending` },
      isLoading: false,
      isError: false,
    });

    const { user } = render(
      <RecentFeedbackTable
        rows={[row]}
        isLoading={false}
        hasMore={false}
        isLoadingMore={false}
        onLoadMore={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Expand row' }));

    expect(screen.getByText(/accepted explanation ending/)).toBeInTheDocument();
    expect(query).toHaveBeenCalledWith('feedback/queries:getFeedbackComment', {
      feedbackId: 'feedback-1',
    });
  });
});
