// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { MouseEventHandler, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { act, render, screen } from '@/tests/utils/render';

import { NotificationListPanel } from './notification-list-panel';

// Shared mock harness for both suites below. The panel drives two independent
// streams — the ORG stream (`../hooks/*`) and the PERSONAL/inbox stream
// (`@/app/features/inbox/hooks/*`) — and exposes a single "Mark all as read"
// button plus a single combined "Load more" affordance off both. Each module is
// mocked exactly once (declaring the same module twice would let one factory
// silently win); the mutable holders below let each test drive the precise
// pending / pagination / unread state it needs.

// --- Mutations -------------------------------------------------------------
// The two "mark all read" mutations live in separate `useBackendMutation`
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
// render. The rollback suites populate both streams and use real row controls.
const orgLoadMore = vi.fn();
const myLoadMore = vi.fn();

interface MockNotification {
  _id: string;
  createdAt: number;
  read: boolean;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
  link?: undefined;
}

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
  // Row payloads for the arrival-announcement suite. Empty by default so the
  // other suites stay focused on the button controls.
  orgResults: [] as MockNotification[],
  myResults: [] as MockNotification[],
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
      results: streamState.orgResults,
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
    results: streamState.myResults,
    status: streamState.my,
    loadMore: myLoadMore,
  }),
  useUnreadNotificationCount: () => streamState.myUnread,
}));

vi.mock('@tanstack/react-router', async () => {
  const actual = await vi.importActual<typeof import('@tanstack/react-router')>(
    '@tanstack/react-router',
  );
  return {
    ...actual,
    Link: ({
      children,
      onClick,
    }: {
      children: ReactNode;
      onClick?: MouseEventHandler<HTMLAnchorElement>;
    }) => (
      <a href="#notification" onClick={onClick}>
        {children}
      </a>
    ),
  };
});

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
  streamState.orgResults = [];
  streamState.myResults = [];
  for (const mutation of [markRead, markMyRead, markAllRead, markAllMyRead]) {
    mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  }
});

describe('NotificationListPanel', () => {
  describe('bulk read rollback (#3609 B1)', () => {
    it.each([
      { orgFails: true, personalFails: true },
      { orgFails: true, personalFails: false },
      { orgFails: false, personalFails: true },
      { orgFails: false, personalFails: false },
    ])(
      'restores only failed streams: %o',
      async ({ orgFails, personalFails }) => {
        streamState.orgResults = [
          {
            _id: 'org-bulk',
            createdAt: 1000,
            read: false,
            titleKey: 'title',
            bodyKey: 'body',
          },
        ];
        streamState.myResults = [
          {
            _id: 'personal-bulk',
            createdAt: 2000,
            read: false,
            titleKey: 'title',
            bodyKey: 'body',
          },
        ];
        streamState.orgUnread = 1;
        streamState.myUnread = 1;
        let settleOrg: () => void = () => {};
        let settlePersonal: () => void = () => {};
        markAllRead.mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((resolve, reject) => {
              settleOrg = () =>
                orgFails ? reject(new Error('Org read failed')) : resolve();
            }),
        );
        markAllMyRead.mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((resolve, reject) => {
              settlePersonal = () =>
                personalFails
                  ? reject(new Error('Personal read failed'))
                  : resolve();
            }),
        );
        const { user, rerender } = renderPanel();
        await user.click(
          screen.getByRole('button', { name: 'Mark all as read' }),
        );
        expect(
          screen.queryAllByRole('button', { name: 'Mark as read' }),
        ).toHaveLength(0);
        await act(async () => {
          settleOrg();
          settlePersonal();
        });
        streamState.orgUnread = orgFails ? 1 : 0;
        streamState.myUnread = personalFails ? 1 : 0;
        streamState.orgResults = streamState.orgResults.map((row) => ({
          ...row,
        }));
        streamState.myResults = streamState.myResults.map((row) => ({
          ...row,
        }));
        rerender(<NotificationListPanel organizationId="org-1" />);
        const failedCount = Number(orgFails) + Number(personalFails);
        expect(
          screen.queryAllByRole('button', { name: 'Mark as read' }),
        ).toHaveLength(failedCount);
        expect(markAllRead.mutateAsync).toHaveBeenCalledWith({
          organizationId: 'org-1',
        });
        expect(markAllMyRead.mutateAsync).toHaveBeenCalledWith({
          organizationId: 'org-1',
        });
        if (failedCount === 0) {
          expect(screen.getByText("You're all caught up")).toBeInTheDocument();
        } else {
          expect(
            screen.queryByText("You're all caught up"),
          ).not.toBeInTheDocument();
          expect(
            screen.getByRole('tab', { name: `Unread (${failedCount})` }),
          ).toBeInTheDocument();
          for (const button of screen.getAllByRole('button', {
            name: 'Mark as read',
          })) {
            expect(button).toBeEnabled();
          }
          if (failedCount === 1) {
            await user.click(
              screen.getByRole('button', { name: 'Mark as read' }),
            );
            const failedMutation = orgFails ? markRead : markMyRead;
            const successfulMutation = orgFails ? markMyRead : markRead;
            expect(failedMutation.mutateAsync).toHaveBeenCalledWith({
              notificationId: orgFails ? 'org-bulk' : 'personal-bulk',
            });
            expect(successfulMutation.mutateAsync).not.toHaveBeenCalled();
          }
          await user.click(
            screen.getByRole('button', { name: 'Mark all as read' }),
          );
          expect(markAllRead.mutateAsync).toHaveBeenCalledTimes(2);
          expect(markAllMyRead.mutateAsync).toHaveBeenCalledTimes(2);
          expect(
            screen.queryAllByRole('button', { name: 'Mark as read' }),
          ).toHaveLength(0);
        }
      },
    );
  });
  describe.each(['org', 'personal'] as const)('read rollback: %s', (stream) => {
    function seedUnread() {
      const notification: MockNotification = {
        _id: `${stream}-notification`,
        createdAt: 1000,
        read: false,
        titleKey: 'title',
        bodyKey: 'body',
        params: {},
      };
      if (stream === 'org') {
        streamState.orgResults = [notification];
        streamState.orgUnread = 1;
      } else {
        streamState.myResults = [notification];
        streamState.myUnread = 1;
      }
      return stream === 'org' ? markRead : markMyRead;
    }

    it.each(['mark-read', 'activate'] as const)(
      'restores a failed %s after a fresh unread response and allows retry',
      async (action) => {
        const mutation = seedUnread();
        let rejectRead: (error: Error) => void = () => {};
        mutation.mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              rejectRead = reject;
            }),
        );
        const { user, rerender } = renderPanel();

        await user.click(
          action === 'mark-read'
            ? screen.getByRole('button', { name: 'Mark as read' })
            : screen.getByRole('link'),
        );
        expect(
          screen.queryByRole('button', { name: 'Mark as read' }),
        ).not.toBeInTheDocument();

        await act(async () => {
          rejectRead(new Error('Connection lost'));
        });
        streamState.orgResults = streamState.orgResults.map((row) => ({
          ...row,
        }));
        streamState.myResults = streamState.myResults.map((row) => ({
          ...row,
        }));
        rerender(<NotificationListPanel organizationId="org-1" />);

        expect(
          screen.getByRole('tab', { name: 'Unread (1)' }),
        ).toBeInTheDocument();
        expect(
          screen.queryByText("You're all caught up"),
        ).not.toBeInTheDocument();
        expect(
          screen.getByRole('button', { name: 'Mark as read' }),
        ).toBeEnabled();
        await user.click(screen.getByRole('button', { name: 'Mark as read' }));
        expect(mutation.mutateAsync).toHaveBeenCalledTimes(2);
        expect(mutation.mutateAsync).toHaveBeenLastCalledWith({
          notificationId: `${stream}-notification`,
        });
      },
    );

    it('keeps a successful read optimistically hidden until the server catches up', async () => {
      const mutation = seedUnread();
      const { user, rerender } = renderPanel();
      await user.click(screen.getByRole('button', { name: 'Mark as read' }));
      rerender(<NotificationListPanel organizationId="org-1" />);
      expect(mutation.mutateAsync).toHaveBeenCalledTimes(1);
      expect(
        screen.queryByRole('button', { name: 'Mark as read' }),
      ).not.toBeInTheDocument();
      expect(screen.getByText("You're all caught up")).toBeInTheDocument();
    });

    it('preserves All as a recovery control for an optimistic dismissal', async () => {
      seedUnread();
      const { user } = renderPanel();
      await user.click(screen.getByRole('button', { name: 'Mark as read' }));
      await user.click(screen.getByRole('tab', { name: 'All' }));
      expect(
        screen.getByRole('button', { name: 'Mark as read' }),
      ).toBeEnabled();
    });
  });

  it('restores only the failed row while another stream has a successful dismissal', async () => {
    streamState.orgResults = [
      {
        _id: 'org-fails',
        createdAt: 1000,
        read: false,
        titleKey: 'title',
        bodyKey: 'body',
      },
    ];
    streamState.myResults = [
      {
        _id: 'personal-succeeds',
        createdAt: 2000,
        read: false,
        titleKey: 'title',
        bodyKey: 'body',
      },
    ];
    streamState.orgUnread = 1;
    streamState.myUnread = 1;
    let rejectRead: (error: Error) => void = () => {};
    markRead.mutateAsync.mockImplementationOnce(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectRead = reject;
        }),
    );
    const { user } = renderPanel();
    await user.click(
      screen.getAllByRole('button', { name: 'Mark as read' })[1],
    );
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    await act(async () => {
      rejectRead(new Error('Connection lost'));
    });
    expect(
      screen.getAllByRole('button', { name: 'Mark as read' }),
    ).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Mark as read' }));
    expect(markRead.mutateAsync).toHaveBeenCalledTimes(2);
    expect(markMyRead.mutateAsync).toHaveBeenCalledTimes(1);
  });
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

  // A polite, sr-only live region announces notifications that arrive while the
  // panel is open, so screen-reader users hear them (#1980). The list already
  // present on first render is never announced.
  describe('new-arrival announcements (#1980)', () => {
    function makeNotification(createdAt: number): MockNotification {
      return {
        _id: `n-${createdAt}`,
        createdAt,
        read: false,
        titleKey: 'title',
        bodyKey: 'body',
        params: {},
      };
    }

    it('does not announce the list already present on first render', () => {
      streamState.orgResults = [makeNotification(1000)];
      renderPanel();
      expect(screen.getByRole('status').textContent).toBe('');
    });

    it('announces a notification that arrives while the panel is open', () => {
      const { rerender } = renderPanel();
      // Region starts empty; then a newer notification arrives.
      expect(screen.getByRole('status').textContent).toBe('');

      streamState.orgResults = [makeNotification(Date.now())];
      rerender(<NotificationListPanel organizationId="org-1" />);

      expect(screen.getByRole('status')).toHaveTextContent('New notifications');
    });
  });

  // The panel drives a single "Load more" affordance off BOTH streams: enabled
  // while either has another page, and a click advances every stream that still
  // has more. These tests pin that combined wiring.

  /** Switch the panel's status filter to "All" via the Unread/All tabs. */
  async function switchFilterToAll(
    user: ReturnType<typeof renderPanel>['user'],
  ) {
    await user.click(screen.getByRole('tab', { name: 'All' }));
  }

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
      await switchFilterToAll(user);

      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(orgLoadMore).toHaveBeenCalledTimes(1);
      expect(myLoadMore).toHaveBeenCalledTimes(1);
    });

    it('shows "Load more" when only the personal stream has more, and advances only it', async () => {
      streamState.org = 'Exhausted';
      streamState.my = 'CanLoadMore';
      const { user } = renderPanel();
      await switchFilterToAll(user);

      await user.click(screen.getByRole('button', { name: 'Load more' }));

      expect(myLoadMore).toHaveBeenCalledTimes(1);
      expect(orgLoadMore).not.toHaveBeenCalled();
    });

    it('shows "Load more" when only the org stream has more, and advances only it', async () => {
      streamState.org = 'CanLoadMore';
      streamState.my = 'Exhausted';
      const { user } = renderPanel();
      await switchFilterToAll(user);

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

  // Pagination walks each stream's read and unread rows together while the
  // Unread tab filters only what is loaded, so an older unread row can wait on
  // a page not loaded yet. The counts prove it is there: the panel must never
  // claim "You're all caught up" over it (#3610).
  describe.each(['org', 'personal'] as const)(
    'unread rows past the loaded pages (#3610): %s',
    (stream) => {
      const OLDER_UNREAD = 'You have older unread notifications';
      const CAUGHT_UP = "You're all caught up";

      function row(id: string, read: boolean, createdAt: number) {
        return { _id: id, createdAt, read, titleKey: 'title', bodyKey: 'body' };
      }

      /** The 25 newest rows of a 26-row stream, all read. */
      function readFirstPage(): MockNotification[] {
        return Array.from({ length: 25 }, (_, index) =>
          row(`${stream}-read-${index}`, true, 100_000 - index),
        );
      }

      function seed(
        rows: MockNotification[],
        status: (typeof streamState)['org'],
        unreadCount: number,
      ) {
        if (stream === 'org') {
          streamState.orgResults = rows;
          streamState.org = status;
          streamState.orgUnread = unreadCount;
        } else {
          streamState.myResults = rows;
          streamState.my = status;
          streamState.myUnread = unreadCount;
        }
      }

      const markOne = () => (stream === 'org' ? markRead : markMyRead);
      const markAll = () => (stream === 'org' ? markAllRead : markAllMyRead);
      const loadMoreSpy = () => (stream === 'org' ? orgLoadMore : myLoadMore);
      const rerenderPanel = (
        rerender: ReturnType<typeof renderPanel>['rerender'],
      ) => rerender(<NotificationListPanel organizationId="org-1" />);

      it('points at the older unread row instead of claiming all caught up, and Load more reveals it', async () => {
        seed(readFirstPage(), 'CanLoadMore', 1);
        const { user, rerender } = renderPanel();

        expect(
          screen.getByRole('tab', { name: 'Unread (1)' }),
        ).toBeInTheDocument();
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.getByText('Load more to see them.')).toBeInTheDocument();

        await user.click(screen.getByRole('button', { name: 'Load more' }));
        expect(loadMoreSpy()).toHaveBeenCalledTimes(1);

        seed(readFirstPage(), 'LoadingMore', 1);
        rerenderPanel(rerender);
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Loading…' })).toBeDisabled();

        seed(
          [...readFirstPage(), row(`${stream}-older-unread`, false, 1_000)],
          'Exhausted',
          1,
        );
        rerenderPanel(rerender);
        expect(
          screen.getByRole('button', { name: 'Mark as read' }),
        ).toBeEnabled();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
      });

      it('counts only the unread rows the loaded pages do not hold', () => {
        seed(
          [row(`${stream}-unread`, false, 100_001), ...readFirstPage()],
          'CanLoadMore',
          1,
        );
        renderPanel();

        expect(
          screen.getByRole('button', { name: 'Mark as read' }),
        ).toBeEnabled();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
      });

      it('keeps pointing at the older row after reading the loaded one, whichever re-read lands first', async () => {
        const loaded = row(`${stream}-unread`, false, 100_001);
        seed([loaded, ...readFirstPage()], 'CanLoadMore', 2);
        const { user, rerender } = renderPanel();

        await user.click(screen.getByRole('button', { name: 'Mark as read' }));
        expect(markOne().mutateAsync).toHaveBeenCalledTimes(1);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();

        // The list re-reads first: the row is read, the count still says 2.
        seed([{ ...loaded, read: true }, ...readFirstPage()], 'CanLoadMore', 2);
        rerenderPanel(rerender);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();

        seed([{ ...loaded, read: true }, ...readFirstPage()], 'CanLoadMore', 1);
        rerenderPanel(rerender);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
      });

      it('stays caught up after reading the last unread row while the count catches up', async () => {
        const loaded = row(`${stream}-unread`, false, 100_001);
        seed([loaded, ...readFirstPage()], 'CanLoadMore', 1);
        const { user, rerender } = renderPanel();

        await user.click(screen.getByRole('button', { name: 'Mark as read' }));
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();

        // The list re-reads before the count: one unread still counted, none
        // loaded — the read itself, not an older row.
        seed([{ ...loaded, read: true }, ...readFirstPage()], 'CanLoadMore', 1);
        rerenderPanel(rerender);
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Load more' }),
        ).not.toBeInTheDocument();

        seed([{ ...loaded, read: true }, ...readFirstPage()], 'CanLoadMore', 0);
        rerenderPanel(rerender);
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Load more' }),
        ).not.toBeInTheDocument();
      });

      it('reads as caught up at once after Mark all as read, the unloaded pages included', async () => {
        const loaded = [
          row(`${stream}-unread-a`, false, 100_002),
          row(`${stream}-unread-b`, false, 100_001),
        ];
        const loadedRead = [
          row(`${stream}-unread-a`, true, 100_002),
          row(`${stream}-unread-b`, true, 100_001),
        ];
        seed([...loaded, ...readFirstPage()], 'CanLoadMore', 5);
        let settle: () => void = () => {};
        markAll().mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((resolve) => {
              settle = resolve;
            }),
        );
        const { user, rerender } = renderPanel();

        await user.click(
          screen.getByRole('button', { name: 'Mark all as read' }),
        );
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Load more' }),
        ).not.toBeInTheDocument();

        await act(async () => {
          settle();
        });
        // The list re-reads first; the count still says 5.
        seed([...loadedRead, ...readFirstPage()], 'CanLoadMore', 5);
        rerenderPanel(rerender);
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();

        seed([...loadedRead, ...readFirstPage()], 'CanLoadMore', 0);
        rerenderPanel(rerender);
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Load more' }),
        ).not.toBeInTheDocument();
      });

      it('drops the figure a failed read held', async () => {
        const newer = row(`${stream}-unread-newer`, false, 100_001);
        const older = row(`${stream}-unread-older`, false, 1_000);
        seed([newer, ...readFirstPage()], 'CanLoadMore', 2);
        let fail: (error: Error) => void = () => {};
        markOne().mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              fail = reject;
            }),
        );
        const { user, rerender } = renderPanel();

        await user.click(screen.getByRole('button', { name: 'Mark as read' }));
        await act(async () => {
          fail(new Error('Connection lost'));
        });
        // Load more brings the older row; read pages remain past it.
        seed([{ ...newer }, ...readFirstPage(), older], 'CanLoadMore', 2);
        rerenderPanel(rerender);
        const rowReads = screen.getAllByRole('button', {
          name: 'Mark as read',
        });
        expect(rowReads).toHaveLength(2);
        await user.click(rowReads[1]);
        await user.click(screen.getByRole('button', { name: 'Mark as read' }));

        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
      });

      it('judges a later count afresh once the count has moved', async () => {
        seed(readFirstPage(), 'CanLoadMore', 1);
        const { user, rerender } = renderPanel();

        await user.click(
          screen.getByRole('button', { name: 'Mark all as read' }),
        );
        seed(readFirstPage(), 'CanLoadMore', 0);
        rerenderPanel(rerender);
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();

        seed(readFirstPage(), 'CanLoadMore', 1);
        rerenderPanel(rerender);
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
      });

      it('never points at older rows when no page is left to hold them', () => {
        seed(readFirstPage(), 'Exhausted', 1);
        renderPanel();

        expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('button', { name: 'Load more' }),
        ).not.toBeInTheDocument();
      });

      it('points at the older row again when Mark all as read fails', async () => {
        seed(readFirstPage(), 'CanLoadMore', 1);
        let fail: (error: Error) => void = () => {};
        markAll().mutateAsync.mockImplementationOnce(
          () =>
            new Promise<void>((_resolve, reject) => {
              fail = reject;
            }),
        );
        const { user } = renderPanel();

        await user.click(
          screen.getByRole('button', { name: 'Mark all as read' }),
        );
        expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();

        await act(async () => {
          fail(new Error('Connection lost'));
        });
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
      });
    },
  );
});
