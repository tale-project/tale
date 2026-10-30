// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { loadDayjsLocale } from '@tale/ui/date';
import type { MouseEventHandler, ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { i18n } from '@/lib/i18n/i18n';
import { forgetSavedLocale, saveLocale } from '@/tests/utils/lapsed-session';
import { act, render, screen, waitFor, within } from '@/tests/utils/render';

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
const orgRetry = vi.fn();
const myRetry = vi.fn();

/** How a stream's read stands, as `useCachedPaginatedQuery` reports it. */
interface MockRead {
  error: Error | null;
  unavailable: boolean;
  isRetrying: boolean;
  errorCount: number;
}

const answered = (): MockRead => ({
  error: null,
  unavailable: false,
  isRetrying: false,
  errorCount: 0,
});

interface MockNotification {
  _id: string;
  createdAt: number;
  read: boolean;
  taskId?: string;
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
  // Each read answered by default; the failed-read suite fails one or both.
  orgRead: answered(),
  myRead: answered(),
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
      retry: orgRetry,
      ...streamState.orgRead,
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
    retry: myRetry,
    ...streamState.myRead,
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
  streamState.orgRead = answered();
  streamState.myRead = answered();
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

  describe('an automation message', () => {
    const message = (extra: Record<string, unknown>): MockNotification => ({
      _id: 'automation-message',
      createdAt: 1000,
      read: false,
      titleKey: 'automationMessage',
      bodyKey: 'automationMessageBody',
      params: {
        automation: 'reports/weekly',
        runId: 'run-1',
        title: 'Weekly report ready',
        message: 'Revenue is up.',
        deliveryKey: 'run-1/tell/0/0',
        ...extra,
      },
    });

    it("shows the author's title, and their words in a frame naming the automation", () => {
      streamState.myResults = [message({})];
      renderPanel();
      expect(screen.getByText('Weekly report ready')).toBeInTheDocument();
      expect(
        screen.getByText(
          (_content, element) =>
            element?.textContent ===
            'Revenue is up.\n\nSent by the automation "reports/weekly".',
        ),
      ).toBeInTheDocument();
    });

    it('names the site a web link opens, opens it in a new tab and marks the row read', async () => {
      streamState.myResults = [
        message({ link: 'https://reports.example.com/weekly' }),
      ];
      const { user } = renderPanel();
      const open = screen.getByRole('link', {
        name: 'Open reports.example.com',
      });
      expect(open).toHaveAttribute(
        'href',
        'https://reports.example.com/weekly',
      );
      expect(open).toHaveAttribute('target', '_blank');
      expect(open).toHaveAttribute('rel', 'noopener noreferrer');
      await user.click(open);
      expect(markMyRead.mutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ notificationId: 'automation-message' }),
      );
    });

    it('offers no web action for a page of the organization', () => {
      streamState.myResults = [message({ link: '/dashboard/org-1/documents' })];
      renderPanel();
      expect(
        screen.queryByRole('link', { name: /^Open / }),
      ).not.toBeInTheDocument();
    });
  });

  describe('a task status change (#3634)', () => {
    // The row stores the board's status ids; the reader sees the labels the
    // task controls show, in their own language — never `in_progress`.
    const statusChange = (
      id: string,
      extra: Record<string, unknown>,
    ): MockNotification => ({
      _id: id,
      createdAt: 1000,
      read: false,
      taskId: 'task-1',
      titleKey: 'taskStatusChanged',
      bodyKey:
        'actor' in extra ? 'taskStatusChangedByBody' : 'taskStatusChangedBody',
      params: {
        title: 'Proof task',
        projectId: 'project-1',
        from: 'in_progress',
        to: 'in_review',
        ...extra,
      },
    });

    // The panel is still mounted when the language goes back to English.
    afterEach(() => act(forgetSavedLocale));

    it.each([
      {
        locale: 'en',
        title: 'Task status changed',
        byActor: 'Robin moved "Proof task" from In progress to In review.',
        impersonal: '"Proof task" moved from In progress to In review.',
      },
      {
        locale: 'de',
        title: 'Aufgabenstatus geändert',
        byActor:
          'Robin hat "Proof task" von In Bearbeitung nach In Prüfung verschoben.',
        impersonal: '"Proof task" wechselte von In Bearbeitung zu In Prüfung.',
      },
      {
        locale: 'fr',
        title: 'Statut de tâche modifié',
        byActor:
          'Robin a fait passer «\u00a0Proof task\u00a0» de En cours à En revue.',
        impersonal:
          '«\u00a0Proof task\u00a0» est passée de En cours à En revue.',
      },
    ] as const)(
      'names both statuses by their task labels ($locale)',
      async ({ locale, title, byActor, impersonal }) => {
        saveLocale(locale);
        await i18n.changeLanguage(locale);
        // The app's shell loads the language's dates on mount (`onChange:
        // loadDayjsLocale` in `main.tsx`); the test shell does not.
        await loadDayjsLocale(locale);
        streamState.myResults = [
          statusChange('by-actor', { actor: 'Robin' }),
          statusChange('impersonal', {}),
        ];
        renderPanel();
        expect(screen.getAllByText(title)).toHaveLength(2);
        for (const body of [byActor, impersonal]) {
          expect(
            screen.getByText(
              (_content, element) => element?.textContent === body,
            ),
          ).toBeInTheDocument();
        }
        expect(document.body).not.toHaveTextContent(/in_progress|in_review/);
      },
    );
  });

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

      it('keeps pointing at the older row after reading the loaded one when the list re-reads first', async () => {
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
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();

        seed([{ ...loaded, read: true }, ...readFirstPage()], 'CanLoadMore', 1);
        rerenderPanel(rerender);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();
      });

      it('keeps pointing at the older row after reading the loaded one when the count re-reads first', async () => {
        const loaded = row(`${stream}-unread`, false, 100_001);
        seed([loaded, ...readFirstPage()], 'CanLoadMore', 2);
        const { user, rerender } = renderPanel();

        await user.click(screen.getByRole('button', { name: 'Mark as read' }));
        expect(markOne().mutateAsync).toHaveBeenCalledTimes(1);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();

        // The count re-reads first: it says 1, the list still reads the row as
        // unread — the read itself, so the older row is still the one left.
        seed([loaded, ...readFirstPage()], 'CanLoadMore', 1);
        rerenderPanel(rerender);
        expect(screen.getByText(OLDER_UNREAD)).toBeInTheDocument();
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Load more' })).toBeEnabled();

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

  // The paginated hook reads a first page that failed as an exhausted empty
  // list, so the panel passed a failed read off as "You're all caught up"
  // (Unread) or "No notifications yet" (All), with no way to ask again, and
  // silently dropped one stream that failed beside rows of the other (#4665).
  describe('a failed read (#4665)', () => {
    const CAUGHT_UP = "You're all caught up";
    const CAUGHT_UP_DESCRIPTION =
      "We'll let you know when anything new comes in.";
    const NOTHING_YET = 'No notifications yet';
    const OLDER_UNREAD = 'You have older unread notifications';
    const LOAD_FAILED = "Couldn't load your notifications.";
    const PARTLY_FAILED = "Some of your notifications couldn't be loaded.";
    const ORG_ROW_TITLE = 'Usage credits requested';
    const PERSONAL_ROW_TITLE = 'You were mentioned';

    /** A first page the retry policy gave up on: no rows, `Exhausted`. */
    const failedFirstPage = (errorCount = 1): MockRead => ({
      error: new Error('Service unavailable'),
      unavailable: true,
      isRetrying: false,
      errorCount,
    });
    /** That first page asked for again: react-query resets it to its first
     * load, so only `unavailable` still says it failed. */
    const retriedFirstPage = (errorCount = 1): MockRead => ({
      error: null,
      unavailable: true,
      isRetrying: true,
      errorCount,
    });
    /** Rows on screen, and the refresh or the page after them failed. */
    const failedAfterRows = (): MockRead => ({
      error: new Error('Service unavailable'),
      unavailable: false,
      isRetrying: false,
      errorCount: 1,
    });

    const orgRow = (id: string, read = false): MockNotification => ({
      _id: id,
      createdAt: 2000,
      read,
      titleKey: 'creditRequestTitle',
      bodyKey: 'auditIntegrityFailed',
    });
    const personalRow = (id: string, read = false): MockNotification => ({
      _id: id,
      createdAt: 1000,
      read,
      titleKey: 'mention',
      bodyKey: 'taskCommented',
    });

    const notice = () => screen.getByRole('alert');
    const tryAgain = () =>
      within(notice()).getByRole('button', { name: 'Try again' });
    const rerenderPanel = (
      rerender: ReturnType<typeof renderPanel>['rerender'],
    ) => rerender(<NotificationListPanel organizationId="org-1" />);

    it.each(['unread', 'all'] as const)(
      'names a failure of both reads with Try again on %s, never an empty state',
      async (filter) => {
        streamState.orgRead = failedFirstPage();
        streamState.myRead = failedFirstPage();
        const { user } = renderPanel();
        if (filter === 'all') await switchFilterToAll(user);

        expect(notice()).toHaveTextContent(LOAD_FAILED);
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
        expect(
          screen.queryByText(CAUGHT_UP_DESCRIPTION),
        ).not.toBeInTheDocument();
        expect(screen.queryByText(NOTHING_YET)).not.toBeInTheDocument();
        expect(screen.queryByText('Loading…')).not.toBeInTheDocument();

        await user.click(tryAgain());
        expect(orgRetry).toHaveBeenCalledTimes(1);
        expect(myRetry).toHaveBeenCalledTimes(1);
      },
    );

    it.each(['org', 'personal'] as const)(
      'shows the rows the other read answered under a notice when only the %s read fails, and Try again asks for that read alone',
      async (failing) => {
        if (failing === 'org') {
          streamState.orgRead = failedFirstPage();
          streamState.myResults = [personalRow('personal-1')];
          streamState.myUnread = 1;
        } else {
          streamState.myRead = failedFirstPage();
          streamState.orgResults = [orgRow('org-1')];
          streamState.orgUnread = 1;
        }
        const { user } = renderPanel();

        expect(notice()).toHaveTextContent(PARTLY_FAILED);
        expect(
          screen.getByText(
            failing === 'org' ? PERSONAL_ROW_TITLE : ORG_ROW_TITLE,
          ),
        ).toBeInTheDocument();
        expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();

        await user.click(tryAgain());
        expect(failing === 'org' ? orgRetry : myRetry).toHaveBeenCalledTimes(1);
        expect(failing === 'org' ? myRetry : orgRetry).not.toHaveBeenCalled();
      },
    );

    it('never claims caught up when the read that answered holds no unread row and the other failed', async () => {
      streamState.orgRead = failedFirstPage();
      streamState.myResults = [personalRow('personal-read', true)];
      const { user } = renderPanel();

      expect(notice()).toHaveTextContent(PARTLY_FAILED);
      expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();

      await switchFilterToAll(user);
      expect(notice()).toHaveTextContent(PARTLY_FAILED);
      expect(screen.getByText(PERSONAL_ROW_TITLE)).toBeInTheDocument();
      expect(screen.queryByText(NOTHING_YET)).not.toBeInTheDocument();
    });

    it('keeps the caught-up and empty states for reads that answered empty', async () => {
      const { user } = renderPanel();

      expect(screen.getByText(CAUGHT_UP)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();

      await switchFilterToAll(user);
      expect(screen.getByText(NOTHING_YET)).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    });

    it('shows the first load as loading, not as a failure', () => {
      streamState.org = 'LoadingFirstPage';
      streamState.my = 'LoadingFirstPage';
      renderPanel();

      expect(screen.getByText('Loading…')).toBeInTheDocument();
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
    });

    it('holds the notice with Try again busy while a retry runs, with no loading state and no empty state', async () => {
      // react-query resets a read that never answered to its first load
      // while it is asked for again.
      streamState.org = 'LoadingFirstPage';
      streamState.my = 'LoadingFirstPage';
      streamState.orgRead = retriedFirstPage();
      streamState.myRead = retriedFirstPage();
      const { user } = renderPanel();

      expect(notice()).toHaveTextContent(LOAD_FAILED);
      expect(tryAgain()).toHaveAttribute('aria-busy', 'true');
      expect(screen.queryByText('Loading…')).not.toBeInTheDocument();
      expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();

      await user.click(tryAgain());
      expect(orgRetry).not.toHaveBeenCalled();
      expect(myRetry).not.toHaveBeenCalled();
    });

    it('keeps a focused Try again through a retry that fails again, and hands its focus to the list once the reads answer', async () => {
      streamState.orgRead = failedFirstPage();
      streamState.myRead = failedFirstPage();
      const { rerender } = renderPanel();
      const retry = tryAgain();
      act(() => retry.focus());

      streamState.org = 'LoadingFirstPage';
      streamState.my = 'LoadingFirstPage';
      streamState.orgRead = retriedFirstPage();
      streamState.myRead = retriedFirstPage();
      rerenderPanel(rerender);
      expect(tryAgain()).toBe(retry);
      expect(retry).toHaveFocus();

      streamState.org = 'Exhausted';
      streamState.my = 'Exhausted';
      streamState.orgRead = failedFirstPage(2);
      streamState.myRead = failedFirstPage(2);
      rerenderPanel(rerender);
      expect(tryAgain()).toBe(retry);
      expect(retry).toHaveFocus();

      streamState.orgRead = answered();
      streamState.myRead = answered();
      streamState.orgResults = [orgRow('org-1')];
      rerenderPanel(rerender);
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText(ORG_ROW_TITLE)).toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole('region', { name: 'Notifications' }),
        ).toHaveFocus(),
      );
    });

    it('loads no further pages of a failed stream through Load more, only through Try again', async () => {
      // The organization stream's page after its first failed; the personal
      // stream still has another page.
      streamState.org = 'CanLoadMore';
      streamState.orgResults = [orgRow('org-1')];
      streamState.orgRead = failedAfterRows();
      streamState.my = 'CanLoadMore';
      streamState.myResults = [personalRow('personal-1')];
      const { user } = renderPanel();

      expect(notice()).toHaveTextContent(PARTLY_FAILED);
      expect(screen.getByText(ORG_ROW_TITLE)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Load more' }));
      expect(myLoadMore).toHaveBeenCalledTimes(1);
      expect(orgLoadMore).not.toHaveBeenCalled();

      await user.click(tryAgain());
      expect(orgRetry).toHaveBeenCalledTimes(1);
      expect(myRetry).not.toHaveBeenCalled();
    });

    it('offers no Load more when only a failed stream has pages left', async () => {
      streamState.org = 'CanLoadMore';
      streamState.orgResults = [orgRow('org-1')];
      streamState.orgRead = failedAfterRows();
      const { user } = renderPanel();
      await switchFilterToAll(user);

      expect(notice()).toHaveTextContent(PARTLY_FAILED);
      expect(screen.getByText(ORG_ROW_TITLE)).toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Load more' }),
      ).not.toBeInTheDocument();
    });

    it('never points at older unread rows that a failed read would have to load', () => {
      streamState.org = 'CanLoadMore';
      streamState.orgResults = Array.from({ length: 25 }, (_, index) => ({
        ...orgRow(`org-read-${index}`, true),
        createdAt: 100_000 - index,
      }));
      streamState.orgUnread = 1;
      streamState.orgRead = failedAfterRows();
      renderPanel();

      expect(notice()).toHaveTextContent(PARTLY_FAILED);
      expect(screen.queryByText(OLDER_UNREAD)).not.toBeInTheDocument();
      expect(screen.queryByText(CAUGHT_UP)).not.toBeInTheDocument();
    });
  });
});
