// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { MouseEventHandler, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor, within } from '@/tests/utils/render';

import { NotificationBell } from './notification-bell';

// The real bell, panel and rows: only the two notification streams and the
// router's `Link` are stubbed. A row that navigates must close whichever
// surface hosts the panel — the compact popover and the expanded dialog alike —
// or the destination stays behind the modal (#3903).

const markAllRead = { mutateAsync: vi.fn(), isPending: false };
const markAllMyRead = { mutateAsync: vi.fn(), isPending: false };
const markRead = { mutateAsync: vi.fn(), isPending: false };
const markMyRead = { mutateAsync: vi.fn(), isPending: false };

interface MockNotification {
  _id: string;
  createdAt: number;
  read: boolean;
  titleKey: string;
  bodyKey: string;
  params?: Record<string, unknown>;
}

const streamState = {
  orgUnread: 0,
  myUnread: 0,
  orgResults: [] as MockNotification[],
  myResults: [] as MockNotification[],
};

// Both streams answered, as `useCachedPaginatedQuery` reports it, so the panel
// shows its empty states rather than a failed read's notice (#4665).
const answeredRead = {
  error: null,
  unavailable: false,
  isRetrying: false,
  errorCount: 0,
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
      status: 'Exhausted',
      loadMore: vi.fn(),
      retry: vi.fn(),
      ...answeredRead,
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
    status: 'Exhausted',
    loadMore: vi.fn(),
    retry: vi.fn(),
    ...answeredRead,
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

beforeEach(() => {
  vi.clearAllMocks();
  streamState.orgUnread = 0;
  streamState.myUnread = 0;
  streamState.orgResults = [];
  streamState.myResults = [];
  for (const mutation of [markAllRead, markAllMyRead, markRead, markMyRead]) {
    mutation.mutateAsync.mockReset().mockResolvedValue(undefined);
  }
});

describe.each(['org', 'personal'] as const)(
  'NotificationBell row navigation: %s',
  (stream) => {
    const notificationId = `${stream}-notification`;

    function seedUnread() {
      const notification: MockNotification = {
        _id: notificationId,
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

    async function openPopover() {
      const rendered = render(<NotificationBell organizationId="org-1" />);
      await rendered.user.click(
        screen.getByRole('button', {
          name: 'Notifications, 1 unread notification',
        }),
      );
      const popover = await screen.findByRole('dialog', {
        name: 'Notifications',
      });
      return { ...rendered, popover };
    }

    async function openExpanded() {
      const { user, popover } = await openPopover();
      await user.click(within(popover).getByRole('button', { name: 'Expand' }));
      // Expand swaps the popover for the modal; both are named "Notifications",
      // so wait until the modal is the only one left.
      const dialog = await screen.findByRole('dialog', {
        name: 'Notifications',
      });
      expect(
        within(dialog).queryByRole('button', { name: 'Expand' }),
      ).not.toBeInTheDocument();
      return { user, dialog };
    }

    it('closes the compact popover when the row navigates', async () => {
      const mutation = seedUnread();
      const { user, popover } = await openPopover();

      await user.click(within(popover).getByRole('link'));

      expect(mutation.mutateAsync).toHaveBeenCalledWith({ notificationId });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('closes the expanded dialog when the row navigates', async () => {
      const mutation = seedUnread();
      const { user, dialog } = await openExpanded();

      await user.click(within(dialog).getByRole('link'));

      expect(mutation.mutateAsync).toHaveBeenCalledWith({ notificationId });
      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
    });

    it('keeps the expanded dialog open when the row is only marked read', async () => {
      const mutation = seedUnread();
      const { user, dialog } = await openExpanded();

      await user.click(
        within(dialog).getByRole('button', { name: 'Mark as read' }),
      );

      expect(mutation.mutateAsync).toHaveBeenCalledWith({ notificationId });
      expect(
        within(dialog).getByText("You're all caught up"),
      ).toBeInTheDocument();
      expect(
        screen.getByRole('dialog', { name: 'Notifications' }),
      ).toBeInTheDocument();
    });
  },
);
