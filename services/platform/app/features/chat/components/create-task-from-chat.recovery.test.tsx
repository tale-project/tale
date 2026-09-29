// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, waitFor } from '@/tests/utils/render';

import type { ChatMessageView } from '../types';

/**
 * A conversation that could not be read must not become a task that lacks
 * its request and files. The real task form keeps what it opened with, so
 * the flow waits for a successful read, says so when the read fails, offers
 * the read again, and — once the conversation is read — opens the form with
 * the request and files, keeping the person's edits from then on.
 */

const state = vi.hoisted(() => ({
  messages: { status: 'unavailable' } as
    | { status: 'unavailable' }
    | { status: 'ready'; data: ChatMessageView[] },
  refetchQueries: vi.fn(async () => undefined),
  createTask: vi.fn(async () => 'task-new'),
}));

vi.mock('../data/chat-backend', () => ({
  useChatProjects: () => ({
    status: 'ready',
    data: [{ id: 'p-web', name: 'Website relaunch' }],
  }),
  useChatMessages: (_org: string, threadId: string | undefined) =>
    threadId === undefined ? { status: 'loading' } : state.messages,
  useChatQueryClient: () => ({ refetchQueries: state.refetchQueries }),
}));

// The real task form and upload hook; only their backend doors are stubbed.
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
vi.mock('@/app/features/tasks/hooks/mutations', async (importOriginal) => ({
  ...(await importOriginal<
    typeof import('@/app/features/tasks/hooks/mutations')
  >()),
  useCreateTask: () => ({ mutateAsync: state.createTask }),
}));
vi.mock('@/app/features/tasks/hooks/use-actor-directory', () => ({
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

const { CreateTaskFromChat } = await import('./create-task-from-chat');

const REQUEST = 'Turn the Q3 numbers into a ten-slide deck';

function conversation(): ChatMessageView[] {
  return [
    {
      id: 'm1',
      role: 'user',
      sequence: 1,
      createdAt: 1,
      parts: [
        { type: 'text', text: REQUEST },
        {
          type: 'attachment',
          name: 'q3.xlsx',
          mediaType: 'application/vnd.ms-excel',
          fileId: 's3:q3',
          sizeBytes: 2048,
        },
      ],
    },
  ];
}

function flow() {
  return (
    <CreateTaskFromChat
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      threadId="t-root"
      viewThreadId="t-view"
      threadTitle="Quarterly deck"
      projectId="p-web"
      viewerIsOwner
    />
  );
}

beforeEach(() => {
  state.messages = { status: 'unavailable' };
  state.refetchQueries.mockClear();
  state.createTask.mockClear();
});

describe('Create task from chat — a conversation that could not be read', () => {
  it('opens no task form, says why, and reads again on request', async () => {
    const { user } = render(flow());

    expect(screen.getByRole('alert')).toHaveTextContent(
      "Tale couldn't read this conversation, so the task can't carry your request and files yet.",
    );
    expect(screen.queryByRole('textbox', { name: /Title/ })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(state.refetchQueries).toHaveBeenCalledWith({
      queryKey: ['backend', 'org-1', 'chat_message', 't-view'],
    });
  });

  it('opens the real form with the request and files once the read succeeds, and keeps later edits', async () => {
    const { user, rerender } = render(flow());
    expect(screen.queryByRole('textbox', { name: /Title/ })).toBeNull();

    state.messages = { status: 'ready', data: conversation() };
    rerender(flow());

    const description = await screen.findByRole('textbox', {
      name: /Description/,
    });
    expect((description as HTMLTextAreaElement).value).toContain(REQUEST);

    // The person's edit survives the conversation changing under the form.
    const title = screen.getByRole('textbox', { name: /Title/ });
    await user.clear(title);
    await user.type(title, 'Board deck for Q3');
    state.messages = {
      status: 'ready',
      data: [
        ...conversation(),
        {
          id: 'm2',
          role: 'user',
          sequence: 2,
          createdAt: 2,
          parts: [{ type: 'text', text: 'A later message' }],
        },
      ],
    };
    rerender(flow());
    expect(screen.getByRole('textbox', { name: /Title/ })).toHaveValue(
      'Board deck for Q3',
    );

    await user.click(screen.getByRole('button', { name: 'Create task' }));
    await waitFor(() => expect(state.createTask).toHaveBeenCalledTimes(1));
    expect(state.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: 'p-web',
        title: 'Board deck for Q3',
        description: expect.stringContaining(REQUEST) as unknown as string,
        attachments: [
          {
            fileId: 's3:q3',
            fileName: 'q3.xlsx',
            fileType: 'application/vnd.ms-excel',
            fileSize: 2048,
          },
        ],
      }),
    );
  });
});
