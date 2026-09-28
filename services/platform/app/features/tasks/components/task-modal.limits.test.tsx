// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  TASK_DESCRIPTION_MAX,
  TASK_TITLE_MAX,
} from '@/backend/core/tasks/helpers';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

import type { TaskDoc } from '../lib/display';
import { TaskModal } from './task-modal';

/**
 * The board names the task caps a save breaks, in the reader's language,
 * instead of the generic error toast: a description over the cap is held
 * back on the create form, and a title or description the server refuses
 * anyway (`TASK_TITLE_INVALID`, `TASK_DESCRIPTION_INVALID`) toasts the cap.
 * Before, an older import's over-long description could not be saved from
 * the task, and nothing said why.
 */

const mutations = vi.hoisted(() => ({
  createTask: vi.fn(),
  updateTask: vi.fn(),
}));
const task = {
  _id: 'task-limits',
  _creationTime: 0,
  organizationId: 'org-limits',
  projectId: 'project-limits',
  title: 'Imported issue',
  status: 'todo',
  rank: 'a0',
  number: 1,
  createdBy: 'user-limits',
  createdByType: 'user',
  createdAt: 0,
  updatedAt: 0,
} satisfies TaskDoc;

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data:
      name === 'tasks/queries:getTask'
        ? { task, canEdit: true, canComment: false }
        : undefined,
    isLoading: false,
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
  useOrganizationId: () => 'org-limits',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'user-limits' } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useCreateTask: () => ({ mutateAsync: mutations.createTask }),
  useUpdateTask: () => ({ mutateAsync: mutations.updateTask }),
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

function renderModal(taskId?: string) {
  return render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId={task.organizationId}
      projectId={task.projectId}
      taskId={taskId}
    />,
  );
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  mutations.createTask.mockReset();
  mutations.updateTask.mockReset();
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the task modal names the caps a save breaks', () => {
  it('holds Create while a pasted description is over the cap', async () => {
    const { user } = renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Ship');
    await user.click(screen.getByRole('textbox', { name: 'Description' }));
    await user.paste('d'.repeat(TASK_DESCRIPTION_MAX + 5));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent(
      'This description is too long to save. It can have up to 20,000 ' +
        'characters, and most emoji count as 2.',
    );
    expect(
      screen.getByRole('textbox', { name: 'Description' }),
    ).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('button', { name: 'Create task' })).toBeDisabled();
    expect(mutations.createTask).not.toHaveBeenCalled();

    // The running length is the field's counter, outside the live alert:
    // a keystroke past the cap moves the count and leaves the alert —
    // the same node, the same words, no new shake — as it was, so a screen
    // reader announces nothing more. The counter describes the field
    // instead, read when it takes focus.
    const field = screen.getByRole('textbox', { name: 'Description' });
    const before = alert.textContent;
    const counter = await screen.findByText('20,005 / 20,000');
    expect(counter).not.toBe(alert);
    expect(field).toHaveAccessibleDescription(
      expect.stringContaining('20,005 / 20,000'),
    );
    // The shake that marked the error's arrival runs out (400 ms)…
    await waitFor(() => expect(field).not.toHaveClass('animate-shake'));
    await user.type(field, '{Backspace}');
    expect(await screen.findByText('20,004 / 20,000')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBe(alert);
    expect(alert.textContent).toBe(before);
    expect(alert).not.toHaveTextContent('20,004');
    // …and a keystroke past the cap does not start another.
    expect(field).not.toHaveClass('animate-shake');
  });

  // The cap is measured as a save sends the description, trimmed; the
  // counter showed the raw length, so surrounding whitespace overstated
  // how much was left to delete (TALE-75 review).
  it('counts a pasted description as the save sends it, trimmed', async () => {
    const { user } = renderModal();

    await user.click(screen.getByRole('textbox', { name: 'Description' }));
    await user.paste(`  ${'d'.repeat(TASK_DESCRIPTION_MAX + 1)}\n\n`);

    expect(await screen.findByText('20,001 / 20,000')).toBeInTheDocument();
    expect(screen.queryByText('20,005 / 20,000')).toBeNull();
  });

  // The inline title holds the create form's cap: a longer one used to be
  // typed, then refused by the server as `TASK_TITLE_INVALID`.
  it("caps the task's inline title at the domain's title limit", async () => {
    renderModal(task._id);

    const titles = await screen.findAllByRole('textbox', { name: 'Title' });
    expect(titles.length).toBeGreaterThan(0);
    for (const title of titles) {
      expect(title).toHaveAttribute('maxLength', String(TASK_TITLE_MAX));
    }
  });

  it('toasts the title cap when the server refuses a title', async () => {
    mutations.createTask.mockRejectedValue(
      new AppError({ code: 'TASK_TITLE_INVALID' }),
    );
    const { user } = renderModal();

    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Ship');
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'A title needs 1 to 200 characters. Most emoji count as 2.',
        variant: 'destructive',
      }),
    );
  });

  it('toasts the description cap when the server refuses a saved description', async () => {
    mutations.updateTask.mockRejectedValue(
      new AppError({ code: 'TASK_DESCRIPTION_INVALID' }),
    );
    const { user } = renderModal(task._id);

    await user.click(
      await screen.findByRole('button', { name: 'Add a description…' }),
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Checked upstream.',
    );
    await user.click(screen.getByRole('button', { name: 'Save' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title:
          'This description is too long to save. It can have up to 20,000 ' +
          'characters, and most emoji count as 2.',
        variant: 'destructive',
      }),
    );
    expect(mutations.updateTask).toHaveBeenCalledWith({
      taskId: task._id,
      description: 'Checked upstream.',
    });
  });
});
