import '@testing-library/jest-dom/vitest';
import { Dialog } from '@tale/ui/dialog/dialog';
import { useState } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

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
  NotificationListPanel: ({ onNavigate }: { onNavigate?: () => void }) => (
    <button
      type="button"
      onClick={() => {
        onNavigate?.();
        io.navigate();
      }}
    >
      Review requested
    </button>
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
  await user.click(screen.getByRole('button', { name: 'Notifications' }));
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
