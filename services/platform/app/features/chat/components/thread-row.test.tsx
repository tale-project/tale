// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { ChatThreadSummary } from '../types';

const navigateMock = vi.hoisted(() => vi.fn());

// The legal-hold indicator's per-row detail read has no Convex client in
// this harness; an empty answer keeps the lock icon rendered with the
// member-level tooltip.
vi.mock(
  '@/app/features/settings/governance/hooks/queries',
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('@/app/features/settings/governance/hooks/queries')
    >()),
    useLegalHoldByTarget: vi.fn(() => ({ data: undefined })),
  }),
);

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
  beforeEach(() => {
    renameMock.mockReset().mockResolvedValue(true);
  });

  async function startRename() {
    const result = renderRow(THREAD);
    await result.user.click(
      screen.getByRole('button', { name: 'More actions' }),
    );
    await result.user.click(screen.getByRole('menuitem', { name: 'Rename' }));
    return {
      ...result,
      input: screen.getByRole('textbox', { name: 'Rename' }),
    };
  }

  it('keeps a refused draft available for retry with an accessible error', async () => {
    renameMock.mockResolvedValueOnce(false);
    const { user, input, container } = await startRename();
    fireEvent.change(input, { target: { value: 'Attempted title' } });
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't rename chat. Try again.",
    );
    expect(input).toHaveValue('Attempted title');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription(
      "Couldn't rename chat. Try again.",
    );
    await checkAccessibility(container);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(renameMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenLastCalledWith('t1', 'Attempted title');
  });

  it('rejects 501 characters and accepts a corrected 500-character title', async () => {
    const { user, input } = await startRename();
    fireEvent.change(input, { target: { value: 'a'.repeat(501) } });
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Use 500 characters or fewer.',
    );
    expect(input).toHaveValue('a'.repeat(501));
    expect(renameMock).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: ` ${'a'.repeat(500)} ` } });
    expect(screen.queryByRole('alert')).toBeNull();
    await user.keyboard('{Enter}');
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(renameMock).toHaveBeenCalledExactlyOnceWith('t1', 'a'.repeat(500));
  });

  it('keeps an empty title open for correction and lets Escape cancel', async () => {
    const { user, input } = await startRename();
    fireEvent.change(input, { target: { value: '  ' } });
    await user.keyboard('{Enter}');
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'Enter a chat title.',
    );
    expect(renameMock).not.toHaveBeenCalled();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('waits for rename and saves once when Enter and blur overlap', async () => {
    let resolveRename: (value: boolean) => void = () => {};
    renameMock.mockImplementationOnce(
      () =>
        new Promise<boolean>((resolve) => {
          resolveRename = resolve;
        }),
    );
    const { user, input } = await startRename();
    fireEvent.change(input, { target: { value: 'Pending title' } });
    await user.keyboard('{Enter}{Enter}');
    fireEvent.blur(input);
    expect(screen.getByRole('textbox')).toHaveValue('Pending title');
    expect(input).toHaveAttribute('readonly');
    expect(renameMock).toHaveBeenCalledTimes(1);
    resolveRename(true);
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
  });

  it('preserves a refused blur draft and allows explicit cancellation', async () => {
    renameMock.mockResolvedValueOnce(false);
    const { user, input } = await startRename();
    fireEvent.change(input, { target: { value: 'Blur draft' } });
    fireEvent.blur(input);
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't rename chat. Try again.",
    );
    expect(screen.getByRole('textbox')).toHaveValue('Blur draft');
    expect(input).not.toHaveAttribute('readonly');
    await user.click(input);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(
      screen.getByRole('link', { name: /Quarterly report/ }),
    ).toBeInTheDocument();
    expect(renameMock).toHaveBeenCalledTimes(1);
  });

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

    // Folder rows are radio items: which project holds the thread is a
    // selectable state, and "remove" is the unchecked way out.
    expect(
      await screen.findByRole('menuitemradio', {
        name: 'Remove from project',
      }),
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

  it('shows the age at the full muted contrast, never faded', () => {
    // 2026-09-26 evaluation, A-08 / G-03: `text-muted-foreground/70` read
    // 2.69:1 on the sidebar — under the 4.5:1 AA bar for the 12px label.
    const { container } = renderRow(THREAD);
    const age = container.querySelector('a span.tabular-nums');
    expect(age).not.toBeNull();
    expect(age).toHaveClass('text-muted-foreground');
    const faded = [...(age?.classList ?? [])].filter((name) =>
      name.startsWith('text-muted-foreground/'),
    );
    expect(faded).toEqual([]);
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
