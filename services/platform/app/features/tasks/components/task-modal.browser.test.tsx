import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen, waitFor } from '@/tests/utils/render';

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

// Stub I/O, not the modal, editable title, responsive primitives or openers.
// No real backend is needed to exercise Chromium's focus and keyboard events.
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data:
      name === 'tasks/queries:getTask' && !read.loading
        ? { task, canEdit: true, canComment: false }
        : undefined,
    isLoading: name === 'tasks/queries:getTask' && read.loading,
  }),
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
