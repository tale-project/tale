import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { ProjectThreadsTab } from './project-threads-tab';

import '@/app/globals.css';

const writes = vi.hoisted(() => ({ share: vi.fn(async () => {}) }));
const visibleCounts = vi.hoisted(() => ({ mine: 1000, shared: 1000 }));
const mine = Array.from({ length: 1000 }, (_, index) => ({
  id: `mine-${index}`,
  title: `Own chat ${index}`,
  updatedAt: 1_700_000_000_000 + index,
  sharedWithProject: false,
}));
const shared = Array.from({ length: 1000 }, (_, index) => ({
  id: `shared-${index}`,
  title: `Shared chat ${index}`,
  updatedAt: 1_700_000_000_000 + index,
  userId: 'member-2',
  authorName: 'Another member',
}));

vi.mock('../hooks/queries', () => ({
  useProjectChatThreads: () => ({
    mine: mine.slice(0, visibleCounts.mine),
    shared: shared.slice(0, visibleCounts.shared),
    isLoading: false,
    unavailable: false,
    stale: false,
    retrying: false,
    failureCount: 0,
    retry: vi.fn(),
  }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetThreadSharedWithProject: () => ({ mutateAsync: writes.share }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
  Link: ({
    children,
    params,
    ...props
  }: {
    children: ReactNode;
    params: { id: string; threadId: string };
    className?: string;
    title?: string;
  }) => (
    <a {...props} href={`/dashboard/${params.id}/chat/${params.threadId}`}>
      {children}
    </a>
  ),
}));

function ChatsHarness() {
  return (
    <div
      data-testid="project-chats-scroll"
      style={{ height: 480, width: 850, overflowY: 'auto' }}
    >
      <ProjectThreadsTab organizationId="org-1" projectId="project-1" />
    </div>
  );
}

function renderChats() {
  return render(<ChatsHarness />);
}

describe('Project chats at scale', () => {
  beforeEach(() => {
    writes.share.mockClear();
    visibleCounts.mine = 1000;
    visibleCounts.shared = 1000;
  });
  afterEach(cleanup);

  it('preserves the reading position and focus across live window thresholds', async () => {
    visibleCounts.mine = 80;
    const { rerender } = renderChats();
    const scroller = screen.getByTestId('project-chats-scroll');
    const lastOwn = screen.getByRole('link', { name: 'Own chat 79' });
    lastOwn.focus();
    await expect.poll(() => scroller.scrollTop).toBeGreaterThan(1000);
    const top = lastOwn.getBoundingClientRect().top;
    const before = scroller.scrollTop;
    visibleCounts.mine = 81;
    rerender(<ChatsHarness />);
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    await expect
      .poll(() => Math.abs(lastOwn.getBoundingClientRect().top - top))
      .toBeLessThan(3);
    expect(lastOwn.isConnected).toBe(true);
    expect(document.activeElement).toBe(lastOwn);
    expect(scroller.scrollTop).toBeGreaterThan(before - 3);

    visibleCounts.mine = 80;
    rerender(<ChatsHarness />);
    await expect
      .poll(() => Math.abs(lastOwn.getBoundingClientRect().top - top))
      .toBeLessThan(3);
    expect(document.activeElement).toBe(lastOwn);
  });

  it('bounds both sections while reaching their final chats through the page scrollport', async () => {
    const { container } = renderChats();
    const scroller = screen.getByTestId('project-chats-scroll');
    const lists = container.querySelectorAll('ul');
    await expect
      .poll(() => container.querySelectorAll('[data-project-thread-id]').length)
      .toBeLessThan(90);
    expect(screen.getByRole('link', { name: 'Own chat 0' })).toBeVisible();
    const ownList = lists[0]!;
    scroller.scrollTop =
      ownList.getBoundingClientRect().bottom -
      scroller.getBoundingClientRect().top +
      scroller.scrollTop -
      scroller.clientHeight;
    await expect
      .poll(() => screen.queryByRole('link', { name: 'Own chat 999' }))
      .not.toBeNull();
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('link', { name: 'Shared chat 999' }))
      .not.toBeNull();
    expect(
      screen.getByRole('link', { name: 'Shared chat 999' }).closest('li'),
    ).toHaveAttribute('aria-posinset', '1000');
    expect(
      container.querySelectorAll('[data-project-thread-id]').length,
    ).toBeLessThan(90);
    scroller.style.width = '390px';
    await expect
      .poll(() => container.querySelectorAll('[data-project-thread-id]').length)
      .toBeLessThan(90);
  });

  it('retains the focused share switch when scrolling away and preserves its write', async () => {
    const { container } = renderChats();
    const scroller = screen.getByTestId('project-chats-scroll');
    await page
      .getByRole('switch', { name: 'Share with project' })
      .first()
      .click();
    const focused = document.activeElement;
    expect(focused?.closest('[data-project-thread-id]')).toHaveAttribute(
      'data-project-thread-id',
      'mine-0',
    );
    expect(writes.share).toHaveBeenCalledWith({
      organizationId: 'org-1',
      threadId: 'mine-0',
      shared: true,
    });
    scroller.scrollTop = scroller.scrollHeight;
    await expect
      .poll(() => screen.queryByRole('link', { name: 'Shared chat 999' }))
      .not.toBeNull();
    expect(document.activeElement).toBe(focused);
    expect(focused?.isConnected).toBe(true);
    expect(
      container.querySelectorAll('[data-project-thread-id]').length,
    ).toBeLessThan(90);
  });
});
