// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { NotificationBell } from './notification-bell';

// The bell's own count hooks — keep them quiet so the component renders without
// a live backend. Values are irrelevant to the dialog-naming assertion.
vi.mock('../hooks/queries', () => ({
  useNotificationsUnreadCount: () => ({ data: 0 }),
}));
vi.mock('@/app/features/inbox/hooks/queries', () => ({
  useUnreadNotificationCount: () => 0,
}));

// The popover body pulls in the full notifications data layer; stub it so the
// test stays focused on the popover container's accessible name.
vi.mock('./notification-list-panel', () => ({
  NotificationListPanel: () => <div data-testid="notification-list-panel" />,
}));

beforeEach(() => {
  vi.clearAllMocks();
});

describe('NotificationBell', () => {
  // Regression test for #2096: Radix renders the popover content as
  // role="dialog"; it must carry an accessible name so screen readers announce
  // it as the "Notifications" dialog rather than an unnamed one (WCAG 4.1.2).
  // Mirrors the [role="dialog"].toHaveAccessibleName(...) pattern in
  // other dialog tests.
  it('gives the notifications popover dialog an accessible name', async () => {
    const { user } = render(<NotificationBell organizationId="org-1" />);

    // No dialog until the popover is opened.
    expect(document.querySelector('[role="dialog"]')).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Notifications' }));

    // The Radix popover renders in a portal (document.body), not inside the
    // render container.
    await waitFor(() =>
      expect(document.querySelector('[role="dialog"]')).toHaveAccessibleName(
        'Notifications',
      ),
    );
  });
});
