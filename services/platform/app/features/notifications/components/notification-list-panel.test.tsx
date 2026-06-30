import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NotificationListPanel } from './notification-list-panel';

// [119] The personal inbox stream is now cursor-paginated like the org stream,
// and the panel drives a single "Load more" affordance off BOTH streams: it is
// enabled while either has another page, and a click advances every stream that
// still has more. These tests pin that combined wiring.
//
// We stub both streams' query hooks so each test can fix the two `status`
// values independently, and the two `loadMore` spies let us assert exactly
// which streams a click advances. Empty result arrays keep the focus on the
// load-more control (which renders below the list regardless of row count) and
// avoid pulling in row/render-target plumbing.

const orgLoadMore = vi.fn();
const myLoadMore = vi.fn();

// Mutated per test before render to drive the two streams' pagination states.
const streamState = {
  org: 'Exhausted' as
    | 'LoadingFirstPage'
    | 'CanLoadMore'
    | 'LoadingMore'
    | 'Exhausted',
  my: 'Exhausted' as
    | 'LoadingFirstPage'
    | 'CanLoadMore'
    | 'LoadingMore'
    | 'Exhausted',
};

// Org stream hooks (`../hooks/queries`, `../hooks/mutations`).
vi.mock('@/app/features/notifications/hooks/queries', () => ({
  useNotificationsList: () => ({
    results: [],
    status: streamState.org,
    loadMore: orgLoadMore,
  }),
  useNotificationsUnreadCount: () => ({ data: 0 }),
}));
vi.mock('@/app/features/notifications/hooks/mutations', () => ({
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

// Personal stream hooks (`@/app/features/inbox/hooks/*`).
vi.mock('@/app/features/inbox/hooks/queries', () => ({
  useMyNotificationsList: () => ({
    results: [],
    status: streamState.my,
    loadMore: myLoadMore,
  }),
  useUnreadNotificationCount: () => 0,
}));
vi.mock('@/app/features/inbox/hooks/mutations', () => ({
  useMarkNotificationRead: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useMarkAllNotificationsRead: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

function renderPanel() {
  return render(<NotificationListPanel organizationId="org-1" />);
}

describe('NotificationListPanel — combined load-more', () => {
  beforeEach(() => {
    orgLoadMore.mockClear();
    myLoadMore.mockClear();
    streamState.org = 'Exhausted';
    streamState.my = 'Exhausted';
  });

  it('hides "Load more" when both streams are exhausted', () => {
    renderPanel();
    expect(
      screen.queryByRole('button', { name: 'Load more' }),
    ).not.toBeInTheDocument();
  });

  it('advances both streams when both can load more', async () => {
    streamState.org = 'CanLoadMore';
    streamState.my = 'CanLoadMore';
    const { user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(orgLoadMore).toHaveBeenCalledTimes(1);
    expect(myLoadMore).toHaveBeenCalledTimes(1);
  });

  it('shows "Load more" when only the personal stream has more, and advances only it', async () => {
    streamState.org = 'Exhausted';
    streamState.my = 'CanLoadMore';
    const { user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(myLoadMore).toHaveBeenCalledTimes(1);
    expect(orgLoadMore).not.toHaveBeenCalled();
  });

  it('shows "Load more" when only the org stream has more, and advances only it', async () => {
    streamState.org = 'CanLoadMore';
    streamState.my = 'Exhausted';
    const { user } = renderPanel();

    await user.click(screen.getByRole('button', { name: 'Load more' }));

    expect(orgLoadMore).toHaveBeenCalledTimes(1);
    expect(myLoadMore).not.toHaveBeenCalled();
  });
});
