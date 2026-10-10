// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import React from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { act, fireEvent, render, screen, waitFor } from '@/tests/utils/render';

import type { ChatProjectSummary, ChatThreadSummary } from '../types';

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
  useParams: () => ({ id: 'org-1' }),
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
  projects: readonly ChatProjectSummary[] = [
    { id: 'p1', name: 'Website revamp' },
  ],
) {
  return render(
    <ThreadListFrameProvider
      value={{
        organizationId: 'org-1',
        projects,
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

async function openRename() {
  const view = renderRow(THREAD);
  await view.user.click(screen.getByRole('button', { name: 'More actions' }));
  await view.user.click(screen.getByRole('menuitem', { name: 'Rename' }));
  return { ...view, input: screen.getByRole('textbox', { name: 'Rename' }) };
}

describe('ThreadRow', () => {
  beforeEach(() => {
    renameMock.mockReset().mockResolvedValue(true);
  });

  it('keeps a refused draft available for retry with an accessible error', async () => {
    renameMock.mockResolvedValueOnce(false);
    const { user, input, container } = await openRename();
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
    const { user, input } = await openRename();
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
    const { user, input } = await openRename();
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
    const { user, input } = await openRename();
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
    const { user, input } = await openRename();
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

  it('leaves a large project catalog untouched until the Move submenu opens', async () => {
    let namesRead = 0;
    const projects = Array.from({ length: 100 }, (_, index) => ({
      id: `project-${index}`,
      get name() {
        namesRead += 1;
        return `Project ${index}`;
      },
    }));
    const { user } = renderRow(THREAD, undefined, undefined, projects);

    expect(namesRead).toBe(0);
    await user.click(screen.getByRole('button', { name: 'More actions' }));
    expect(namesRead).toBe(0);
    await user.click(screen.getByRole('menuitem', { name: /Move to project/ }));
    expect(
      await screen.findByRole('menuitemradio', { name: /Project 99/ }),
    ).toBeInTheDocument();
    expect(namesRead).toBeGreaterThan(0);
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

  it('keeps the rename open while Enter confirms an IME candidate', async () => {
    const { input } = await openRename();

    // Japanese input in Chromium: the Enter that confirms the candidate
    // arrives mid-composition. It belongs to the IME, so the field stays
    // open with the finished text; the next ordinary Enter saves it, once.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'にほん' } });
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true, keyCode: 229 });
    fireEvent.compositionEnd(input);

    expect(renameMock).not.toHaveBeenCalled();
    expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue(
      'にほん',
    );

    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith('t1', 'にほん'),
    );
    expect(renameMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('leaves composition keys to the IME, Escape included', async () => {
    const { input } = await openRename();
    fireEvent.change(input, { target: { value: '你好' } });

    // The three guards on their own: the `isComposing` flag, the legacy Safari
    // keyCode (Safari ends the composition before its keydown), and the
    // composition-event mirror for browsers that surface neither.
    fireEvent.keyDown(input, { key: 'Enter', isComposing: true });
    fireEvent.keyDown(input, { key: 'Enter', keyCode: 229 });
    fireEvent.compositionStart(input);
    fireEvent.keyDown(input, { key: 'Enter' });
    // Escape mid-composition cancels the candidate, not the rename.
    fireEvent.keyDown(input, { key: 'Escape' });
    fireEvent.compositionEnd(input);
    // Safari ends the composition first, then sends the cancelling Escape.
    fireEvent.keyDown(input, { key: 'Escape', keyCode: 229 });

    expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue('你好');
    expect(renameMock).not.toHaveBeenCalled();

    // An ordinary Escape still cancels without saving.
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(screen.queryByRole('textbox')).toBeNull();
    expect(renameMock).not.toHaveBeenCalled();
  });

  it('keeps a refused draft open through IME keys before a successful retry', async () => {
    renameMock.mockResolvedValueOnce(false);
    const { input } = await openRename();
    fireEvent.change(input, { target: { value: 'にほん' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(await screen.findByRole('alert')).toHaveTextContent(
      "Couldn't rename chat. Try again.",
    );

    for (const key of ['Enter', 'Escape']) {
      fireEvent.keyDown(input, { key, isComposing: true });
      fireEvent.keyDown(input, { key, keyCode: 229 });
      fireEvent.compositionStart(input);
      fireEvent.keyDown(input, { key });
      fireEvent.compositionEnd(input);
    }

    expect(screen.getByRole('textbox', { name: 'Rename' })).toHaveValue(
      'にほん',
    );
    expect(input).toHaveAccessibleDescription(
      "Couldn't rename chat. Try again.",
    );
    expect(renameMock).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(input, { key: 'Enter' });
    await waitFor(() => expect(screen.queryByRole('textbox')).toBeNull());
    expect(renameMock).toHaveBeenCalledTimes(2);
    expect(renameMock).toHaveBeenLastCalledWith('t1', 'にほん');
  });

  it('commits the rename on blur', async () => {
    const { user, input } = await openRename();

    await user.clear(input);
    await user.type(input, 'Board deck');
    fireEvent.blur(input);

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith('t1', 'Board deck'),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('commits on blur mid-composition too: the guard never holds focus', async () => {
    const { input } = await openRename();

    // Focus leaving ends the composition; the field saves what it shows.
    fireEvent.compositionStart(input);
    fireEvent.change(input, { target: { value: 'にほん' } });
    fireEvent.blur(input);

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith('t1', 'にほん'),
    );
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('saves once when a blur follows Enter in the same batch', async () => {
    const { input } = await openRename();
    fireEvent.change(input, { target: { value: 'Board deck' } });

    // One React batch: the field is still mounted when the blur lands.
    act(() => {
      fireEvent.keyDown(input, { key: 'Enter' });
      fireEvent.blur(input);
    });

    await waitFor(() =>
      expect(renameMock).toHaveBeenCalledWith('t1', 'Board deck'),
    );
    expect(renameMock).toHaveBeenCalledTimes(1);
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
    await checkAccessibility(container);
  });
});
