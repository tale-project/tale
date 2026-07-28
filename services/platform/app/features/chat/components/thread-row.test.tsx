// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { ChatThreadSummary } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    params: _params,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
    params: Record<string, string>;
    className?: string;
    'aria-current'?: 'page';
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
  useNavigate: () => navigateMock,
}));

const renameMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const setPinnedMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const setArchivedMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
const trashMock = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));

vi.mock('../data/thread-actions', () => ({
  useThreadActions: () => ({
    available: true,
    rename: renameMock,
    setPinned: setPinnedMock,
    setArchived: setArchivedMock,
    markRead: vi.fn(),
    trash: trashMock,
  }),
}));

vi.mock('../data/thread-sharing', () => ({
  useThreadSharing: () => ({
    available: true,
    share: vi.fn(() => Promise.resolve('token')),
    unshare: vi.fn(() => Promise.resolve(true)),
  }),
}));

vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return {
    ...original,
    useThreadProjectMove: vi.fn(() => ({
      available: true,
      move: vi.fn(() => Promise.resolve(true)),
    })),
  };
});

import { ThreadDndProvider } from './thread-dnd';
import { ThreadListFrameProvider } from './thread-list-context';
import { ThreadRow } from './thread-row';

const THREAD: ChatThreadSummary = {
  id: 't1',
  title: 'Quarterly report',
  kind: 'direct',
  archived: false,
  createdAt: Date.now() - 60_000,
  updatedAt: Date.now() - 60_000,
  generating: false,
};

const NO_HELD = new Set<string>();

function renderRow(
  thread: ChatThreadSummary,
  variant?: 'default' | 'archived',
  holds?: { orgHeld?: boolean; heldThreadIds?: ReadonlySet<string> },
) {
  return render(
    <ThreadListFrameProvider
      value={{
        organizationId: 'org-1',
        projects: [{ id: 'p1', name: 'Website revamp' }],
        orgHeld: holds?.orgHeld ?? false,
        heldThreadIds: holds?.heldThreadIds ?? NO_HELD,
      }}
    >
      <ThreadDndProvider organizationId="org-1">
        <ul>
          <ThreadRow thread={thread} {...(variant ? { variant } : {})} />
        </ul>
      </ThreadDndProvider>
    </ThreadListFrameProvider>,
  );
}

describe('ThreadRow', () => {
  it('offers the full action set from one menu', async () => {
    const { user } = renderRow(THREAD);

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    for (const item of ['Pin chat', 'Rename', 'Archive', 'Share']) {
      expect(screen.getByRole('menuitem', { name: item })).toBeInTheDocument();
    }
    expect(
      screen.getByRole('menuitem', { name: /Move to project/ }),
    ).toBeInTheDocument();
  });

  it('offers the folders and the way out under Move to project', async () => {
    const { user } = renderRow({ ...THREAD, projectId: 'p1' });

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: /Move to project/ }));

    expect(
      await screen.findByRole('menuitem', { name: 'Remove from project' }),
    ).toBeInTheDocument();
  });

  it('renames inline: menu item swaps in an input, Enter commits', async () => {
    const { user } = renderRow(THREAD);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Rename' }));

    const input = screen.getByRole('textbox', { name: 'Rename' });
    expect(input).toHaveValue('Quarterly report');
    await user.clear(input);
    await user.type(input, '  Board deck  {Enter}');

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith('t1', 'Board deck'),
    );
    // The row is back to its link presentation.
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('shows the unread dot only while the reply is newer than the read mark', () => {
    const { rerender } = renderRow({
      ...THREAD,
      lastReplyAt: 2000,
      lastReadAt: 1000,
    });
    expect(screen.getByRole('status', { name: 'New response' })).toBeVisible();

    rerender(
      <ThreadListFrameProvider
        value={{
          organizationId: 'org-1',
          projects: [],
          orgHeld: false,
          heldThreadIds: NO_HELD,
        }}
      >
        <ThreadDndProvider organizationId="org-1">
          <ul>
            <ThreadRow
              thread={{ ...THREAD, lastReplyAt: 2000, lastReadAt: 3000 }}
            />
          </ul>
        </ThreadDndProvider>
      </ThreadListFrameProvider>,
    );
    expect(screen.queryByRole('status', { name: 'New response' })).toBeNull();
  });

  it('reduces the archived variant to Unarchive', async () => {
    const { user } = renderRow({ ...THREAD, archived: true }, 'archived');

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(
      screen.getByRole('menuitem', { name: 'Unarchive' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('menuitem', { name: 'Archive' })).toBeNull();
    expect(screen.queryByRole('menuitem', { name: 'Rename' })).toBeNull();
  });

  it('archives from the menu and reports success', async () => {
    const { user } = renderRow(THREAD);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Archive' }));

    await waitFor(() =>
      expect(setArchivedMock).toHaveBeenCalledWith('t1', true),
    );
  });

  it('deletes through the confirm dialog — menu "Delete", confirm "Delete chat"', async () => {
    const { user } = renderRow(THREAD);

    await user.click(screen.getByRole('button', { name: 'More actions' }));
    await user.click(screen.getByRole('menuitem', { name: 'Delete' }));
    expect(trashMock).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Delete chat' }));

    await waitFor(() => expect(trashMock).toHaveBeenCalledWith('t1'));
  });

  it('disables the destructive actions while a hold covers the row', async () => {
    const { user } = renderRow(THREAD, undefined, {
      heldThreadIds: new Set(['t1']),
    });

    await user.click(screen.getByRole('button', { name: 'More actions' }));

    expect(screen.getByText('Blocked by legal hold')).toBeInTheDocument();
    expect(screen.getByRole('menuitem', { name: 'Delete' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(screen.getByRole('menuitem', { name: 'Archive' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    // Non-destructive actions stay usable.
    expect(
      screen.getByRole('menuitem', { name: 'Rename' }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('passes an axe audit', async () => {
    const { container } = renderRow({
      ...THREAD,
      pinnedAt: 1,
      lastReplyAt: 2000,
      lastReadAt: 1000,
    });
    await waitFor(() => checkAccessibility(container));
  });
});
