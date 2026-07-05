// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NotificationListPanel } from './notification-list-panel';

// Shared mock harness for both suites below. The panel drives two independent
// streams — the ORG stream (`../hooks/*`) and the PERSONAL/inbox stream
// (`@/app/features/inbox/hooks/*`) — and exposes a single "Mark all as read"
// button plus a single combined "Load more" affordance off both. Each module is
// mocked exactly once (declaring the same module twice would let one factory
// silently win); the mutable holders below let each test drive the precise
// pending / pagination / unread state it needs.

// --- Mutations -------------------------------------------------------------
// The two "mark all read" mutations live in separate `useConvexMutation`
// instances (org stream vs. personal stream), so their `isPending` flags are
// independent. The bug (#2019) was that the button only guarded the org
// stream, so it could re-enable mid-flight while the personal stream was still
// running. These controllable flags let each test drive either pending state.
const markAllRead = { mutateAsync: vi.fn(), isPending: false };
const markAllMyRead = { mutateAsync: vi.fn(), isPending: false };
const markRead = { mutateAsync: vi.fn(), isPending: false };
const markMyRead = { mutateAsync: vi.fn(), isPending: false };

// --- Pagination / unread state --------------------------------------------
// The personal inbox stream is cursor-paginated like the org stream, and the
// panel drives a single "Load more" affordance off BOTH streams: it is enabled
// while either has another page, and a click advances every stream that still
// has more. The `loadMore` spies let us assert exactly which streams a click
// advances; the `status` and `unread` fields are mutated per test before
// render. Empty result arrays keep both suites focused on the button controls
// (which render regardless of row count) and avoid row/render-target plumbing.
const orgLoadMore = vi.fn();
const myLoadMore = vi.fn();

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
  // Unread counts gate the "Mark all as read" button's visibility
  // (`unreadCount > 0`). Default 0 (button hidden); the gating suite raises one
  // so the button renders.
  orgUnread: 0,
  myUnread: 0,
};

// --- Org stream hooks (`../hooks/*`) --------------------------------------
vi.mock('../hooks/mutations', () => ({
  useMarkAllNotificationsRead: () => markAllRead,
  useMarkNotificationRead: () => markRead,
}));

vi.mock('../hooks/queries', async () => {
  const actual =
    await vi.importActual<typeof import('../hooks/queries')>(
      '../hooks/queries',
    );
  return {
    ...actual,
    useNotificationsList: () => ({
      results: [],
      status: streamState.org,
      loadMore: orgLoadMore,
    }),
    useNotificationsUnreadCount: () => ({ data: streamState.orgUnread }),
  };
});

// --- Personal/inbox stream hooks (`@/app/features/inbox/hooks/*`) ---------
vi.mock('@/app/features/inbox/hooks/mutations', () => ({
  useMarkAllNotificationsRead: () => markAllMyRead,
  useMarkNotificationRead: () => markMyRead,
}));

vi.mock('@/app/features/inbox/hooks/queries', () => ({
  useMyNotificationsList: () => ({
    results: [],
    status: streamState.my,
    loadMore: myLoadMore,
  }),
  useUnreadNotificationCount: () => streamState.myUnread,
}));

function renderPanel() {
  return render(<NotificationListPanel organizationId="org-1" />);
}

beforeEach(() => {
  vi.clearAllMocks();
  markAllRead.isPending = false;
  markAllMyRead.isPending = false;
  markRead.isPending = false;
  markMyRead.isPending = false;
  streamState.org = 'Exhausted';
  streamState.my = 'Exhausted';
  streamState.orgUnread = 0;
  streamState.myUnread = 0;
});

describe('NotificationListPanel', () => {
  // Regression test for #2019: "Mark all as read" must stay disabled for the
  // full duration of BOTH mutations it fires (org + personal stream), not just
  // the org stream — otherwise a second submission can slip through while the
  // personal-stream mutation is still in-flight.
  describe('mark-all-as-read gating (#2019)', () => {
    beforeEach(() => {
      // Render with an unread count > 0 so the "Mark all as read" button shows,
      // keeping these tests focused on its disabled gating.
      streamState.orgUnread = 1;
    });

    it('disables the button while only the personal-stream mutation is in-flight', () => {
      // Org stream already settled, personal stream still running — the exact
      // window the bug allowed a double submit in.
      markAllRead.isPending = false;
      markAllMyRead.isPending = true;

      render(<NotificationListPanel organizationId="org-1" />);

      expect(
        screen.getByRole('button', { name: 'Mark all as read' }),
      ).toBeDisabled();
    });

    it('disables the button while only the org-stream mutation is in-flight', () => {
      markAllRead.isPending = true;
      markAllMyRead.isPending = false;

      render(<NotificationListPanel organizationId="org-1" />);

      expect(
        screen.getByRole('button', { name: 'Mark all as read' }),
      ).toBeDisabled();
    });

    it('enables the button once both mutations have settled', () => {
      markAllRead.isPending = false;
      markAllMyRead.isPending = false;

      render(<NotificationListPanel organizationId="org-1" />);

      expect(
        screen.getByRole('button', { name: 'Mark all as read' }),
      ).toBeEnabled();
    });
  });

  // The panel drives a single "Load more" affordance off BOTH streams: enabled
  // while either has another page, and a click advances every stream that still
  // has more. These tests pin that combined wiring.
  describe('combined load-more', () => {
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
      // Default Unread filter hides load-more on an empty list; All keeps it
      // visible while older read pages remain paginated.
      await user.click(screen.getByRole('tab', { name: 'All' }));

      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(orgLoadMore).toHaveBeenCalledTimes(1);
      expect(myLoadMore).toHaveBeenCalledTimes(1);
    });

    it('shows "Load more" when only the personal stream has more, and advances only it', async () => {
      streamState.org = 'Exhausted';
      streamState.my = 'CanLoadMore';
      const { user } = renderPanel();
      await user.click(screen.getByRole('tab', { name: 'All' }));

      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(myLoadMore).toHaveBeenCalledTimes(1);
      expect(orgLoadMore).not.toHaveBeenCalled();
    });

    it('shows "Load more" when only the org stream has more, and advances only it', async () => {
      streamState.org = 'CanLoadMore';
      streamState.my = 'Exhausted';
      const { user } = renderPanel();
      await user.click(screen.getByRole('tab', { name: 'All' }));

      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(orgLoadMore).toHaveBeenCalledTimes(1);
      expect(myLoadMore).not.toHaveBeenCalled();
    });

    it('hides "Load more" on Unread when caught up but older read pages remain', () => {
      streamState.org = 'CanLoadMore';
      streamState.orgUnread = 0;
      streamState.myUnread = 0;

      renderPanel();

      expect(
        screen.queryByRole('button', { name: 'Load more' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    });
  });
});
