// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import { defaultNewTaskStartDate } from '../lib/create-defaults';
import { TaskModal } from './task-modal';

/**
 * The board's own create: a new task starts at Medium priority and today,
 * and "Create another" keeps the dialog open for the next one — the words
 * and files cleared, everything a run of similar tasks shares kept, the
 * caret back in Title. The keyboard creates from either field.
 */

const mutations = vi.hoisted(() => ({ createTask: vi.fn() }));
const upload = vi.hoisted(() => ({
  config: undefined as undefined | { initialAttachments?: readonly unknown[] },
  clearAttachments: vi.fn(),
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
  ...(await import('@/tests/utils/router-link-stub')).routerLinkStub,
  useNavigate: () => vi.fn(),
}));
vi.mock('../hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../hooks/mutations')>()),
  useCreateTask: () => ({ mutateAsync: mutations.createTask }),
}));
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    members: [],
    agents: [],
    resolveActor: () => ({ name: 'Teammate' }),
  }),
  useAssignableActors: () => ({
    subjectEntries: [],
    assignableMembers: [],
    assignableAgents: [{ type: 'agent', id: 'agent-1', name: 'Analyst' }],
    agents: [],
    resolveActor: () => ({ name: 'Analyst' }),
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
      clearAttachments: upload.clearAttachments,
    };
  },
}));
vi.mock('./task-attachments', () => ({ TaskAttachments: () => null }));

function openBlank(onOpenChange = vi.fn()) {
  return {
    onOpenChange,
    ...render(
      <TaskModal
        open
        onOpenChange={onOpenChange}
        organizationId="org-1"
        projectId="project-1"
      />,
    ),
  };
}

beforeEach(() => {
  vi.mocked(toast).mockClear();
  mutations.createTask.mockReset().mockResolvedValue('task-new');
  upload.clearAttachments.mockClear();
  window.localStorage.clear();
});

describe("TaskModal — the board's create", () => {
  it('starts a new task at Medium priority and today', async () => {
    const { user } = openBlank();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'Launch');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() =>
      expect(mutations.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Launch',
          priority: 'p2',
          startDate: defaultNewTaskStartDate(),
        }),
      ),
    );
  });

  it('closes after a create unless Create another is on', async () => {
    const { user, onOpenChange } = openBlank();
    const toggle = screen.getByRole('switch', { name: 'Create another' });
    expect(toggle).not.toBeChecked();
    await user.type(screen.getByRole('textbox', { name: 'Title' }), 'One');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });

  it('keeps the dialog for the next task with Create another', async () => {
    const { user, onOpenChange } = openBlank();
    await user.click(screen.getByRole('switch', { name: 'Create another' }));
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.type(title, 'First of many');
    await user.type(
      screen.getByRole('textbox', { name: 'Description' }),
      'Body text',
    );
    await user.click(screen.getByRole('button', { name: 'Create task' }));

    await waitFor(() => expect(mutations.createTask).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(title).toHaveValue(''));
    expect(screen.getByRole('textbox', { name: 'Description' })).toHaveValue(
      '',
    );
    expect(upload.clearAttachments).toHaveBeenCalled();
    expect(title).toHaveFocus();
    expect(onOpenChange).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Task created',
        action: expect.anything(),
      }),
    );

    // The next one shares what the first one had.
    await user.type(title, 'Second');
    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(mutations.createTask).toHaveBeenCalledTimes(2));
    expect(mutations.createTask).toHaveBeenLastCalledWith(
      expect.objectContaining({
        title: 'Second',
        priority: 'p2',
        status: 'todo',
      }),
    );
  });

  it('remembers Create another for the next time the dialog opens', async () => {
    const first = openBlank();
    await first.user.click(
      screen.getByRole('switch', { name: 'Create another' }),
    );
    first.unmount();
    openBlank();
    expect(
      screen.getByRole('switch', { name: 'Create another' }),
    ).toBeChecked();
  });

  it('moves from the title to the description on Enter and creates on ⌘/Ctrl+Enter', async () => {
    const { user } = openBlank();
    const title = screen.getByRole('textbox', { name: 'Title' });
    await user.type(title, 'Keyboard task{Enter}');
    const description = screen.getByRole('textbox', { name: 'Description' });
    expect(description).toHaveFocus();
    expect(mutations.createTask).not.toHaveBeenCalled();

    await user.type(description, 'Line one{Enter}line two');
    expect(description).toHaveValue('Line one\nline two');
    await user.keyboard('{Control>}{Enter}{/Control}');
    await waitFor(() =>
      expect(mutations.createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Keyboard task',
          description: 'Line one\nline two',
        }),
      ),
    );
  });
});
