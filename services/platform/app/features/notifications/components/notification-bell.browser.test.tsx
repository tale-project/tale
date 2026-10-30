import '@testing-library/jest-dom/vitest';
import { Dialog } from '@tale/ui/dialog/dialog';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { NotificationBell } from './notification-bell';

import '@/app/globals.css';

const io = vi.hoisted(() => ({ navigate: () => {} }));
vi.mock('../hooks/queries', () => ({
  useNotificationsUnreadCount: () => ({ data: 1 }),
}));
vi.mock('@/app/features/inbox/hooks/queries', () => ({
  useUnreadNotificationCount: () => 0,
}));
vi.mock('./notification-list-panel', () => ({
  NotificationListPanel: ({
    onExpand,
    onNavigate,
  }: {
    onExpand?: () => void;
    onNavigate?: () => void;
  }) => (
    <>
      {onExpand && (
        <button type="button" onClick={onExpand}>
          Expand
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          onNavigate?.();
          io.navigate();
        }}
      >
        Review requested
      </button>
    </>
  ),
}));
function Harness() {
  const [open, setOpen] = useState(false);
  io.navigate = () => setOpen(true);
  return (
    <>
      <NotificationBell organizationId="org-1" />
      <Dialog open={open} onOpenChange={setOpen} title="Review task">
        <button type="button">Change status</button>
      </Dialog>
    </>
  );
}
afterEach(cleanup);
it('keeps focus inside a task dialog opened by a notification after the popover closes', async () => {
  await page.viewport(1280, 800);
  const { user } = render(<Harness />);
  // One unread notification is mocked, and the bell's name carries it.
  await user.click(
    screen.getByRole('button', {
      name: 'Notifications, 1 unread notification',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Review requested' }));
  const task = await screen.findByRole('dialog', { name: 'Review task' });
  await waitFor(() => expect(task.contains(document.activeElement)).toBe(true));
  // Wait for the closing animation's focus restoration, the reported race.
  await waitFor(() =>
    expect(screen.queryByRole('dialog', { name: 'Notifications' })).toBeNull(),
  );
  expect(task.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(task.contains(document.activeElement)).toBe(true);
});
it('keeps focus inside a task dialog opened by a notification after the expanded view closes', async () => {
  await page.viewport(1280, 800);
  const { user } = render(<Harness />);
  await user.click(
    screen.getByRole('button', {
      name: 'Notifications, 1 unread notification',
    }),
  );
  await user.click(screen.getByRole('button', { name: 'Expand' }));
  const notifications = await screen.findByRole('dialog', {
    name: 'Notifications',
  });
  // The popover, and the Expand button the modal opened from, are gone once
  // its closing animation ends.
  await waitFor(() =>
    expect(
      screen.queryByRole('button', { name: 'Expand', hidden: true }),
    ).toBeNull(),
  );
  await user.click(
    within(notifications).getByRole('button', { name: 'Review requested' }),
  );
  const task = await screen.findByRole('dialog', { name: 'Review task' });
  await waitFor(() => expect(task.contains(document.activeElement)).toBe(true));
  // The task dialog hides the rest of the page from the accessibility tree,
  // the modal behind it included, so a role query would miss one left open
  // (#3903): wait for the element itself to go.
  await waitFor(() => expect(notifications).not.toBeInTheDocument());
  // The modal returns focus after it unmounts; the task dialog keeps it.
  expect(task.contains(document.activeElement)).toBe(true);
  await user.tab();
  expect(task.contains(document.activeElement)).toBe(true);
});
