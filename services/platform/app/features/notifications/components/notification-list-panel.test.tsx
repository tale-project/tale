// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { NotificationListPanel } from './notification-list-panel';

// The two "mark all read" mutations live in separate `useConvexMutation`
// instances (org stream vs. personal stream), so their `isPending` flags are
// independent. The bug (#2019) was that the button only guarded the org
// stream, so it could re-enable mid-flight while the personal stream was still
// running. These controllable flags let each test drive either pending state.
const markAllRead = { mutateAsync: vi.fn(), isPending: false };
const markAllMyRead = { mutateAsync: vi.fn(), isPending: false };
const markRead = { mutateAsync: vi.fn(), isPending: false };
const markMyRead = { mutateAsync: vi.fn(), isPending: false };

// `../hooks/mutations` → org stream (markAllRead / markRead).
vi.mock('../hooks/mutations', () => ({
  useMarkAllNotificationsRead: () => markAllRead,
  useMarkNotificationRead: () => markRead,
}));

// `@/app/features/inbox/hooks/mutations` → personal stream
// (markAllMyRead / markMyRead).
vi.mock('@/app/features/inbox/hooks/mutations', () => ({
  useMarkAllNotificationsRead: () => markAllMyRead,
  useMarkNotificationRead: () => markMyRead,
}));

// Queries: render the panel with an unread count > 0 so the
// "Mark all as read" button is shown, but with empty lists so the test stays
// focused on the button's disabled gating.
vi.mock('../hooks/queries', async () => {
  const actual =
    await vi.importActual<typeof import('../hooks/queries')>(
      '../hooks/queries',
    );
  return {
    ...actual,
    useNotificationsList: () => ({
      results: [],
      status: 'Exhausted',
      loadMore: vi.fn(),
    }),
    useNotificationsUnreadCount: () => ({ data: 1 }),
  };
});

vi.mock('@/app/features/inbox/hooks/queries', () => ({
  useMyNotifications: () => ({ notifications: [], isLoading: false }),
  useUnreadNotificationCount: () => 0,
}));

beforeEach(() => {
  vi.clearAllMocks();
  markAllRead.isPending = false;
  markAllMyRead.isPending = false;
  markRead.isPending = false;
  markMyRead.isPending = false;
});

describe('NotificationListPanel', () => {
  // Regression test for #2019: "Mark all as read" must stay disabled for the
  // full duration of BOTH mutations it fires (org + personal stream), not just
  // the org stream — otherwise a second submission can slip through while the
  // personal-stream mutation is still in-flight.
  describe('mark-all-as-read gating (#2019)', () => {
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
});
