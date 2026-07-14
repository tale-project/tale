// @vitest-environment jsdom
import { IconButton } from '@tale/ui/icon-button';
import '@testing-library/jest-dom/vitest';
import { Maximize2 } from 'lucide-react';
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

// The popover body pulls in the full notifications data layer; stub it to a
// deterministic surface. The stub keeps the real production shape that
// matters for #2650: an `IconButton` (Expand) as the FIRST tabbable element,
// so Radix's open-auto-focus lands there exactly like it does in production
// — an `IconButton` always wraps itself in its own Tooltip, and focusing it
// opens that tooltip, which is the actual mechanism that swallowed Escape.
vi.mock('./notification-list-panel', () => ({
  NotificationListPanel: ({ onExpand }: { onExpand?: () => void }) => (
    <div data-testid="notification-list-panel">
      <IconButton aria-label="Expand" icon={Maximize2} onClick={onExpand} />
    </div>
  ),
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

  describe('popover open focus (#2650)', () => {
    it('does not auto-focus the expand button or show its tooltip on open', async () => {
      const { user } = render(<NotificationBell organizationId="org-1" />);
      const trigger = screen.getByRole('button', { name: 'Notifications' });

      await user.click(trigger);

      await waitFor(() =>
        expect(document.querySelector('[role="dialog"]')).toBeInTheDocument(),
      );
      expect(document.activeElement).toBe(trigger);
      expect(screen.queryByRole('tooltip', { name: 'Expand' })).toBeNull();
    });

    it('closes the popover on Escape and returns focus to the bell trigger', async () => {
      const { user } = render(<NotificationBell organizationId="org-1" />);
      const trigger = screen.getByRole('button', { name: 'Notifications' });

      await user.click(trigger);

      await waitFor(() =>
        expect(document.querySelector('[role="dialog"]')).toBeInTheDocument(),
      );
      expect(document.activeElement).toBe(trigger);

      await user.keyboard('{Escape}');

      await waitFor(() =>
        expect(document.querySelector('[role="dialog"]')).toBeNull(),
      );
      expect(document.activeElement).toBe(trigger);
    });
  });
});
