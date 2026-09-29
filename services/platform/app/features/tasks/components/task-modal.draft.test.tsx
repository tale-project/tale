// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { TaskModal, type TaskDraft } from './task-modal';

/**
 * A create can start from a draft — the task a chat hands over — instead of
 * a blank form: its title, description and files are in place and editable,
 * and a caller that reports the created task itself (with a way to open it)
 * replaces the plain "Task created" toast.
 */

const mutations = vi.hoisted(() => ({ createTask: vi.fn() }));
const upload = vi.hoisted(() => ({
  config: undefined as undefined | { initialAttachments?: readonly unknown[] },
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: undefined, isLoading: false }),
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
  useOrganizationId: () => 'org-1',
}));
vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({ data: { userId: 'u1' } }),
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useCreateTask: () => ({ mutateAsync: mutations.createTask }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
  useAssignableActors: () => ({
    assignableMembers: [],
    assignableAgents: [],
    agents: [],
  }),
}));
// The upload hook starts its list from the draft's files: the form's files
// are the ones it was handed.
vi.mock('@/app/features/shared/files/use-file-upload', () => ({
  useFileUpload: (config: { initialAttachments?: readonly unknown[] }) => {
    upload.config = config;
    return {
      attachments: [...(config.initialAttachments ?? [])],
      uploadingFiles: [],
      uploadFiles: vi.fn(),
      removeAttachment: vi.fn(),
    };
  },
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));

const DRAFT: TaskDraft = {
  title: 'Quarterly deck',
  description:
    'Turn the Q3 numbers into a ten-slide deck\n\n[From the chat: Quarterly deck](https://tale.example.com/dashboard/org-1/chat/t1)',
  attachments: [
    {
      fileId: 's3:q3',
      fileName: 'q3.xlsx',
      fileType: 'application/vnd.ms-excel',
      fileSize: 2048,
    },
  ],
};

function openCreate(props: { onTaskCreated?: (taskId: string) => void } = {}) {
  return render(
    <TaskModal
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      draft={DRAFT}
      onTaskCreated={props.onTaskCreated}
    />,
  );
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  mutations.createTask.mockReset().mockResolvedValue('task-new');
  upload.config = undefined;
});

describe('TaskModal — a create drafted from a chat', () => {
  it('starts with the draft, every field still editable', () => {
    openCreate();

    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue(
      'Quarterly deck',
    );
    expect(screen.getByRole('textbox', { name: /Description/ })).toHaveValue(
      DRAFT.description,
    );
    expect(upload.config?.initialAttachments).toEqual(DRAFT.attachments);
  });

  it('creates the task the draft describes and hands it to the caller', async () => {
    const onTaskCreated = vi.fn();
    const { user } = openCreate({ onTaskCreated });

    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(onTaskCreated).toHaveBeenCalledWith('task-new'));
    expect(mutations.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'project-1',
        title: 'Quarterly deck',
        description: DRAFT.description,
        attachments: DRAFT.attachments,
      }),
    );
    // The caller's report replaces the plain toast.
    expect(toast).not.toHaveBeenCalled();
  });

  it('keeps the plain toast for a caller that reports nothing', async () => {
    const { user } = openCreate();

    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() =>
      expect(toast).toHaveBeenCalledWith({
        title: 'Task created',
        variant: 'success',
      }),
    );
  });
});
