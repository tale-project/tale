import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskCard } from './task-card';
import { TaskModal } from './task-modal';
import { TasksList } from './tasks-list';

import '@/app/globals.css';

const read = vi.hoisted(() => ({ loading: false }));
const task = {
  _id: 'task-focus',
  _creationTime: 0,
  organizationId: 'org-focus',
  projectId: 'project-focus',
  title: 'Review keyboard access',
  status: 'todo',
  rank: 'a0',
  number: 1,
  createdBy: 'user-focus',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
} satisfies TaskDoc;

// A second task, for moving from one task to another inside the dialog, and
// the ids a board can hold for a task that is gone or not the viewer's.
const other = {
  ...task,
  _id: 'task-other',
  number: 2,
  title: 'Draft the release notes',
} satisfies TaskDoc;
const MISSING_ID = 'task-missing';
const DENIED_ID = 'task-denied';

// Stub I/O, not the modal, editable title, responsive primitives or openers.
// No real backend is needed to exercise Chromium's focus and keyboard events.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string, args?: unknown) => {
    if (name !== 'tasks/queries:getTask') {
      return { data: undefined, isLoading: false };
    }
    if (read.loading) return { data: undefined, isLoading: true };
    const taskId =
      args !== null && typeof args === 'object' && 'taskId' in args
        ? args.taskId
        : undefined;
    // The adapter reads a 404 as `null`; a task that is not the viewer's
    // answers TASK_FORBIDDEN. Both settle on the not-found state.
    if (taskId === MISSING_ID) return { data: null, isLoading: false };
    if (taskId === DENIED_ID) {
      return {
        data: undefined,
        isLoading: false,
        error: { data: { code: 'TASK_FORBIDDEN' } },
      };
    }
    return {
      data: {
        task: taskId === other._id ? other : task,
        canEdit: true,
        canComment: false,
      },
      isLoading: false,
    };
  },
}));
vi.mock('@/app/hooks/use-backend-mutation', () => ({
  useBackendMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-action', () => ({
  useBackendAction: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/hooks/use-backend-client', () => ({
  useBackendClient: () => ({ query: vi.fn(async () => null) }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-focus',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-focus' } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Test owner' }),
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
  }),
}));
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: () => ({ attachments: [], uploadingFiles: [] }),
}));
vi.mock('./task-comments', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-comments')>()),
  TaskComments: () => null,
  TaskCommentComposer: () => null,
  TaskCommentComposerSkeleton: () => null,
}));
vi.mock('./task-timeline', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./task-timeline')>()),
  TaskTimeline: () => null,
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));

function Harness({
  view = 'board',
  defaultOpen = false,
}: {
  view?: 'board' | 'list' | 'create';
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <>
      {view === 'board' ? (
        <TaskCard
          task={task}
          canWorkTask={() => true}
          onOpen={() => setOpen(true)}
        />
      ) : view === 'list' ? (
        <TasksList
          tasks={[task]}
          canWorkTask={() => true}
          onOpenTask={() => setOpen(true)}
        />
      ) : (
        <button type="button" onClick={() => setOpen(true)}>
          New task
        </button>
      )}
      <TaskModal
        open={open}
        onOpenChange={setOpen}
        organizationId={task.organizationId}
        projectId={task.projectId}
        taskId={view === 'create' ? undefined : task._id}
      />
    </>
  );
}

async function expectTrapped(dialog: HTMLElement) {
  // Cross both edges, not just a single Tab between two inside controls.
  const controls = Array.from(
    dialog.querySelectorAll<HTMLElement>('button, input, textarea, [tabindex]'),
  ).filter((element) => element.tabIndex >= 0 && !element.matches(':disabled'));
  for (let index = 0; index <= controls.length; index++) {
    await userEvent.tab();
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
  for (let index = 0; index <= controls.length; index++) {
    await userEvent.tab({ shift: true });
    expect(dialog.contains(document.activeElement)).toBe(true);
  }
}

afterEach(cleanup);
beforeEach(() => {
  read.loading = false;
});

describe.each([
  { viewport: 'desktop', width: 1280, height: 800 },
  { viewport: 'mobile', width: 390, height: 844 },
])('TaskModal keyboard focus ($viewport)', ({ width, height }) => {
  beforeEach(async () => {
    await page.viewport(width, height);
  });

  it('enters a loaded task from its board opener and restores it on Escape', async () => {
    render(<Harness />);
    const opener = screen.getByRole('button', { name: task.title });
    opener.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: task.title });
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(screen.getByRole('textbox', { name: 'Title' })).not.toHaveFocus();
    expect(dialog).toHaveClass('outline-none');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).toBeNull();
      expect(opener).toHaveFocus();
    });
    await userEvent.keyboard('{Enter}');
    const reopened = await screen.findByRole('dialog', { name: task.title });
    await waitFor(() => expect(reopened).toHaveFocus());
    await expectTrapped(reopened);
  });

  it('moves pointer-opened list focus inside and contains keyboard navigation', async () => {
    render(<Harness view="list" />);
    await userEvent.click(screen.getByText(task.title));
    const dialog = await screen.findByRole('dialog', { name: task.title });
    await waitFor(() => expect(dialog).toHaveFocus());
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await userEvent.click(screen.getByText(task.title));
    await expectTrapped(
      await screen.findByRole('dialog', { name: task.title }),
    );
  });

  it('keeps focus inside from loading through task arrival and warm reopening', async () => {
    read.loading = true;
    const { rerender } = render(<Harness />);
    const opener = screen.getByRole('button', { name: task.title });
    opener.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    expect(dialog).toHaveClass('outline-none');
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
    read.loading = false;
    rerender(<Harness />);
    const loaded = await screen.findByRole('dialog', { name: task.title });
    expect(loaded).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    await waitFor(() => expect(opener).toHaveFocus());
    await userEvent.keyboard('{Enter}');
    await waitFor(() => expect(screen.getByRole('dialog')).toHaveFocus());
    await expectTrapped(screen.getByRole('dialog'));
  });

  it('focuses the loading dialog when a task deep link starts open', async () => {
    read.loading = true;
    render(<Harness defaultOpen />);
    const dialog = await screen.findByRole('dialog');
    await waitFor(() => expect(dialog).toHaveFocus());
    await expectTrapped(dialog);
  });

  it('preserves the new task title autofocus', async () => {
    render(<Harness view="create" />);
    const opener = screen.getByRole('button', { name: 'New task' });
    opener.focus();
    await userEvent.keyboard('{Enter}');
    await waitFor(() =>
      expect(screen.getByRole('textbox', { name: 'Title' })).toHaveFocus(),
    );
  });
});

/**
 * The board drives its task dialog from ONE value, the open task's id: `open`
 * is `id !== null`, and a close clears the id in the same update
 * (TasksWorkspace). The browser's Back ends in that same update, through the
 * `?task=` sync; this harness has no router, so it clears the id itself. The
 * native Back (history, router, the sync) is the production-build probe's
 * (`TASK-F54`). Radix and vaul then keep the content mounted for the exit
 * animation, which used to render the empty create form at its own height
 * (#3939).
 */
const board = {
  setOpenId: (_id: string | null): void => {
    throw new Error('BoardHarness is not mounted');
  },
};

function BoardHarness() {
  const [openId, setOpenId] = useState<string | null>(null);
  board.setOpenId = setOpenId;
  return (
    <>
      <TaskCard
        task={task}
        canWorkTask={() => true}
        onOpen={() => setOpenId(task._id)}
      />
      <TaskModal
        open={openId !== null}
        onOpenChange={(open) => {
          if (!open) setOpenId(null);
        }}
        organizationId={task.organizationId}
        projectId={task.projectId}
        taskId={openId}
        onOpenTask={setOpenId}
      />
    </>
  );
}

// Longer than the design tokens' exit, so every check lands inside the window
// in which the closing dialog is still on screen. jsdom runs no animations:
// only a real browser keeps the content mounted while it leaves.
const EXIT_MS = 800;

async function openedDialog(name: string): Promise<HTMLElement> {
  const dialog = await screen.findByRole('dialog', { name });
  await Promise.all(
    dialog.getAnimations().map((animation) => animation.finished),
  );
  return dialog;
}

/** The dialog on its way out: still mounted, already closed. */
function closingDialog(): Promise<HTMLElement> {
  return waitFor(
    () => {
      const dialog = document.querySelector<HTMLElement>(
        '[role="dialog"][data-state="closed"]',
      );
      if (dialog === null) throw new Error('No dialog is closing');
      return dialog;
    },
    { timeout: EXIT_MS / 2, interval: 10 },
  );
}

async function expectLeavesAs(name: string, height: number) {
  const dialog = await closingDialog();
  expect(dialog).toHaveAccessibleName(name);
  // Never the create form: its title field, its heading, its height.
  expect(dialog.querySelector('#task-title')).toBeNull();
  expect(within(dialog).queryByText('Create task')).toBeNull();
  expect(dialog.getBoundingClientRect().height).toBeCloseTo(height, 0);
  await waitFor(
    () => expect(document.querySelector('[role="dialog"]')).toBeNull(),
    {
      timeout: EXIT_MS * 4,
    },
  );
}

describe.each([
  { viewport: 'desktop', width: 1280, height: 800, mobile: false },
  { viewport: 'mobile', width: 390, height: 844, mobile: true },
])('TaskModal close ($viewport)', ({ width, height, mobile }) => {
  let exitStyle: HTMLStyleElement;
  beforeEach(async () => {
    await page.viewport(width, height);
    exitStyle = document.createElement('style');
    exitStyle.textContent = `
      @keyframes tale-test-dialog-out { from { opacity: 1; } to { opacity: 0.4; } }
      [role="dialog"][data-state="closed"] {
        animation: tale-test-dialog-out ${EXIT_MS}ms linear forwards !important;
      }
    `;
    document.head.append(exitStyle);
  });
  afterEach(() => exitStyle.remove());

  const closes = [
    {
      way: 'Escape',
      close: () => userEvent.keyboard('{Escape}'),
    },
    // The phone's drawer has no X: it closes by the backdrop, a swipe, Back.
    ...(mobile
      ? []
      : [
          {
            way: 'the X',
            close: async () => {
              const dialog = screen.getByRole('dialog');
              const buttons = within(dialog).getAllByRole('button', {
                name: 'Close',
              });
              await userEvent.click(buttons[buttons.length - 1]!);
            },
          },
        ]),
    {
      way: 'the backdrop',
      close: async () => {
        const overlay = document.querySelector<HTMLElement>('.bg-bg-overlay');
        if (overlay === null) throw new Error('No backdrop');
        // Beside the centred dialog; above the drawer on a phone.
        await page.elementLocator(overlay).click({
          position: mobile ? { x: width / 2, y: 8 } : { x: 8, y: 8 },
        });
      },
    },
    {
      // What Back ends in: the `?task=` sync clears the id without going
      // through the dialog. Not the browser's own Back (no router here).
      way: 'the id clearing, as Back does',
      close: async () => {
        act(() => board.setOpenId(null));
      },
    },
  ];

  it.each(closes)(
    'leaves as the open task, at its height, when closed by $way',
    async ({ close }) => {
      render(<BoardHarness />);
      const opener = screen.getByRole('button', { name: task.title });
      await userEvent.click(opener);
      const dialog = await openedDialog(task.title);
      const openHeight = dialog.getBoundingClientRect().height;

      await close();
      await expectLeavesAs(task.title, openHeight);
      await waitFor(() => expect(opener).toHaveFocus());
    },
  );

  it('leaves as the task it moved to', async () => {
    render(<BoardHarness />);
    await userEvent.click(screen.getByRole('button', { name: task.title }));
    await openedDialog(task.title);

    act(() => board.setOpenId(other._id));
    const moved = await openedDialog(other.title);
    const openHeight = moved.getBoundingClientRect().height;

    await userEvent.keyboard('{Escape}');
    await expectLeavesAs(other.title, openHeight);
  });

  it.each([
    { reason: 'a deleted task', id: MISSING_ID },
    { reason: 'a task the viewer may not read', id: DENIED_ID },
  ])('leaves on its not-found state for $reason', async ({ id }) => {
    render(<BoardHarness />);
    // A deep link: the board holds the id, the detail read settles on nothing.
    act(() => board.setOpenId(id));
    const dialog = await openedDialog('Tasks');
    expect(
      within(dialog).getByText(
        "We couldn't find that task. It may have been deleted.",
      ),
    ).toBeVisible();
    const openHeight = dialog.getBoundingClientRect().height;

    await userEvent.keyboard('{Escape}');
    const closing = await closingDialog();
    expect(
      within(closing).getByText(
        "We couldn't find that task. It may have been deleted.",
      ),
    ).toBeInTheDocument();
    await expectLeavesAs('Tasks', openHeight);
  });
});
