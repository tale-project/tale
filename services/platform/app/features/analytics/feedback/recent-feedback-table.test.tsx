import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  backendFetch,
  backendApiErrorFromBody,
} from '@/app/lib/backend/api-client';
import { backendKey } from '@/app/lib/backend/query-keys';
import { i18n } from '@/lib/i18n/i18n';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import { act, cleanup, render, screen, waitFor } from '@/tests/utils/render';

import { RecentFeedbackTable } from './recent-feedback-table';
import type { RecentFeedbackItem } from './types';

vi.mock('@/app/lib/backend/api-client', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/lib/backend/api-client')>()),
  backendFetch: vi.fn(),
}));

const fullComment = 'a'.repeat(620) + ' accepted explanation ending';
const row: RecentFeedbackItem = {
  _id: 'feedback-1',
  threadId: 'thread-1',
  messageId: 'message-1',
  userId: 'user-1',
  userDisplayName: 'Ada',
  rating: 'positive',
  comment: fullComment.slice(0, 500) + '…',
  commentTruncated: true,
  agentSlug: 'support',
  model: 'model',
  provider: 'provider',
  arenaVerdict: null,
  arenaModelA: null,
  arenaModelB: null,
  isArena: false,
  createdAt: 1,
};

const clients: QueryClient[] = [];

function mount(
  item: RecentFeedbackItem | null = row,
  options: { error?: Error; retry?: () => void } = {},
) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, retryDelay: 0 } },
  });
  clients.push(client);
  window.history.replaceState(
    {},
    '',
    '/dashboard/org-1/settings/metrics/feedback',
  );
  return {
    client,
    ...render(
      <QueryClientProvider client={client}>
        <RecentFeedbackTable
          rows={item ? [item] : []}
          isLoading={false}
          hasMore={false}
          isLoadingMore={false}
          onLoadMore={vi.fn()}
          error={options.error}
          retry={options.retry}
        />
      </QueryClientProvider>,
    ),
  };
}

afterEach(async () => {
  cleanup();
  for (const client of clients.splice(0)) client.clear();
  vi.mocked(backendFetch).mockReset();
  await forgetSavedLocale();
});

describe('RecentFeedbackTable', () => {
  it.each(['en', 'de', 'fr'] as const)(
    'announces an initial read failure with retry (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      const retry = vi.fn();
      const { user } = mount(null, {
        error: new Error('read failed'),
        retry,
      });
      expect(screen.queryByText('Ada')).not.toBeInTheDocument();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        i18n.t('feedback.recent.loadFailed', { ns: 'analytics' }),
      );
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('feedback.recent.retry', { ns: 'analytics' }),
        }),
      );
      expect(retry).toHaveBeenCalledOnce();
      expect(
        screen.queryByText(
          i18n.t('feedback.recent.emptyTitle', { ns: 'analytics' }),
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(
          i18n.t('feedback.recent.emptyDescription', { ns: 'analytics' }),
        ),
      ).not.toBeInTheDocument();
    },
  );

  it.each(['en', 'de', 'fr'] as const)(
    'keeps the successful empty state when there is no error (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      mount(null);
      expect(screen.queryByText('Ada')).not.toBeInTheDocument();
      expect(
        screen.getByText(
          i18n.t('feedback.recent.emptyTitle', { ns: 'analytics' }),
        ),
      ).toBeVisible();
      expect(
        screen.getByText(
          i18n.t('feedback.recent.emptyDescription', { ns: 'analytics' }),
        ),
      ).toBeVisible();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    },
  );

  it('requests full text only after expansion and retains the preview while loading', async () => {
    let finish: (value: { comment: string }) => void = () => {};
    vi.mocked(backendFetch).mockImplementation(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const { user } = mount();
    expect(backendFetch).not.toHaveBeenCalled();
    expect(screen.getByText(row.comment!)).toBeVisible();
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(screen.getAllByText(row.comment!)).toHaveLength(2);
    expect(screen.getByText('Loading full comment…')).toHaveAttribute(
      'role',
      'status',
    );
    expect(backendFetch).toHaveBeenCalledWith(
      '/feedback/recent/feedback-1/comment',
      { orgId: 'org-1' },
    );
    await act(async () => finish({ comment: fullComment }));
    expect(await screen.findByText(fullComment)).toBeVisible();
    expect(screen.queryByText('Loading full comment…')).not.toBeInTheDocument();
    expect(screen.getByText(fullComment).parentElement).toHaveAttribute(
      'aria-live',
      'polite',
    );
  });

  it.each([null, '', 'short comment', 'a'.repeat(500) + '…'])(
    'renders a complete or absent comment without a request (%s)',
    async (comment) => {
      const { user } = mount({ ...row, comment, commentTruncated: false });
      await user.click(screen.getByRole('button', { name: 'Expand row' }));
      expect(backendFetch).not.toHaveBeenCalled();
      expect(
        screen.queryByText('Loading full comment…'),
      ).not.toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      if (comment) expect(screen.getAllByText(comment)).toHaveLength(2);
      if (comment === null)
        expect(screen.getByText('(no comment)')).toBeVisible();
    },
  );

  it.each(['en', 'de', 'fr'] as const)(
    'retains the preview and announces localized loading/errors (%s)',
    async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      let fail: (error: Error) => void = () => {};
      vi.mocked(backendFetch).mockImplementation(
        () =>
          new Promise((_resolve, reject) => {
            fail = reject;
          }),
      );
      const { user } = mount();
      await user.click(
        screen.getByRole('button', {
          name: i18n.t('aria.expandRow', { ns: 'common' }),
        }),
      );
      expect(
        screen.getByText(
          i18n.t('feedback.recent.loadingComment', { ns: 'analytics' }),
        ),
      ).toHaveAttribute('role', 'status');
      await act(async () =>
        fail(backendApiErrorFromBody(404, { error: 'not_found' })),
      );
      expect(await screen.findByRole('alert')).toHaveTextContent(
        i18n.t('feedback.recent.commentLoadFailed', { ns: 'analytics' }),
      );
      expect(screen.getAllByText(row.comment!)).toHaveLength(2);
    },
  );

  it('keeps previously fetched full text visible after a refetch fails', async () => {
    vi.mocked(backendFetch).mockResolvedValueOnce({ comment: fullComment });
    const { user, client } = mount();
    await user.click(screen.getByRole('button', { name: 'Expand row' }));
    expect(await screen.findByText(fullComment)).toBeVisible();
    vi.mocked(backendFetch).mockRejectedValue(new Error('refetch failed'));
    await act(async () => {
      await client.invalidateQueries({
        queryKey: backendKey('org-1', 'metrics', 'feedback-comment', row._id),
      });
    });
    await waitFor(() =>
      expect(
        client.getQueryState(
          backendKey('org-1', 'metrics', 'feedback-comment', row._id),
        )?.status,
      ).toBe('error'),
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText(fullComment)).toBeVisible();
  });
});
