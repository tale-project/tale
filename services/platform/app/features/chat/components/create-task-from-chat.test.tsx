// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { ChatMessageView, ChatProjectSummary } from '../types';

/**
 * "Create task from chat" opens the task dialog already holding the
 * conversation's request, its files and the way back — in the chat's own
 * project, or one the person picks first — and reports the created task
 * with a way to open it.
 */

const state = vi.hoisted(() => ({
  projects: [] as ChatProjectSummary[],
  agentsByProject: {} as Record<string, { _id: string }[]>,
  projectsFailed: false,
  messages: [] as ChatMessageView[],
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../data/chat-backend', () => ({
  useChatQueryClient: () => ({ refetchQueries: vi.fn(async () => undefined) }),
  useChatProjects: () =>
    state.projectsFailed
      ? { status: 'unavailable' }
      : { status: 'ready', data: state.projects },
  useChatMessages: (_org: string, threadId: string | undefined) =>
    threadId === undefined
      ? { status: 'loading' }
      : { status: 'ready', data: state.messages },
}));

vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectAgents: (projectId: string | undefined) => ({
    agents:
      projectId === undefined ? [] : (state.agentsByProject[projectId] ?? []),
    isLoading: false,
  }),
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => state.navigate,
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: state.toast,
}));

// The task dialog's own form is covered by its tests; here it only has to
// show what it was opened with, and create on demand.
vi.mock('@/app/features/tasks/components/task-modal', () => ({
  TaskModal: ({
    projectId,
    draft,
    onTaskCreated,
  }: {
    projectId: string;
    draft?: {
      title: string;
      description: string;
      attachments: readonly { fileName: string }[];
      assignee?: { type: string; id: string };
      sourceThreadId?: string;
      startAgent?: boolean;
    };
    onTaskCreated?: (taskId: string) => void;
  }) => (
    <div role="dialog" aria-label="Create task">
      <p data-testid="project">{projectId}</p>
      <p data-testid="assignee">{draft?.assignee?.id}</p>
      <p data-testid="source">{draft?.sourceThreadId}</p>
      <p data-testid="start">{String(draft?.startAgent === true)}</p>
      <p data-testid="title">{draft?.title}</p>
      <p data-testid="description">{draft?.description}</p>
      <p data-testid="files">
        {draft?.attachments.map((file) => file.fileName).join(',')}
      </p>
      <button type="button" onClick={() => onTaskCreated?.('task-9')}>
        Create
      </button>
    </div>
  ),
}));

const { CreateTaskFromChat } = await import('./create-task-from-chat');

const WEBSITE = { id: 'p-web', name: 'Website relaunch' };
const HANDBOOK = { id: 'p-hb', name: 'Employee handbook' };

function conversation(): ChatMessageView[] {
  return [
    {
      id: 'm1',
      role: 'user',
      sequence: 1,
      createdAt: 1,
      parts: [
        { type: 'text', text: 'Turn the Q3 numbers into a ten-slide deck' },
        {
          type: 'attachment',
          name: 'q3.xlsx',
          mediaType: 'application/vnd.ms-excel',
          fileId: 's3:q3',
          sizeBytes: 2048,
        },
      ],
    },
    {
      id: 'm2',
      role: 'assistant',
      sequence: 2,
      createdAt: 2,
      parts: [{ type: 'text', text: 'Chat cannot create files …' }],
    },
  ];
}

function open(props: { projectId?: string; viewerIsOwner?: boolean } = {}) {
  return render(
    <CreateTaskFromChat
      open
      onOpenChange={vi.fn()}
      organizationId="org-1"
      threadId="t-root"
      viewThreadId="t-view"
      threadTitle="Quarterly deck"
      projectId={props.projectId}
      viewerIsOwner={props.viewerIsOwner ?? true}
    />,
  );
}

beforeEach(() => {
  state.projects = [WEBSITE, HANDBOOK];
  state.agentsByProject = {};
  state.projectsFailed = false;
  state.messages = conversation();
  state.navigate.mockReset();
  state.toast.mockReset();
});

describe('CreateTaskFromChat', () => {
  it("opens the task dialog in the chat's own project, drafted from the conversation", () => {
    open({ projectId: WEBSITE.id });

    expect(screen.getByTestId('project')).toHaveTextContent(WEBSITE.id);
    expect(screen.getByTestId('title')).toHaveTextContent('Quarterly deck');
    expect(screen.getByTestId('description')).toHaveTextContent(
      'Turn the Q3 numbers into a ten-slide deck',
    );
    // The way back names the root conversation.
    expect(screen.getByTestId('description')).toHaveTextContent(
      '[From the chat: Quarterly deck](http://localhost:3000/dashboard/org-1/chat/t-root)',
    );
    expect(screen.getByTestId('files')).toHaveTextContent('q3.xlsx');
  });

  it('asks for a project first when the chat is filed in none', async () => {
    const { user } = open();

    expect(
      screen.getByRole('dialog', { name: 'Create a task from this chat' }),
    ).toBeInTheDocument();
    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeDisabled();

    await user.click(screen.getByRole('button', { name: /^Project/ }));
    await user.click(screen.getByRole('option', { name: /Employee handbook/ }));
    await user.click(next);

    expect(screen.getByTestId('project')).toHaveTextContent(HANDBOOK.id);
  });

  it('says there is no project yet, and offers no way on', () => {
    state.projects = [];
    open();

    expect(
      screen.getByText(
        "There's no project to create the task in yet. Ask an Editor or Admin to create one.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it('keeps the chat in its project, and says so plainly, when the project list fails', () => {
    state.projectsFailed = true;
    const { unmount } = open({ projectId: WEBSITE.id });
    expect(screen.getByTestId('project')).toHaveTextContent(WEBSITE.id);
    unmount();

    // No project to fall back on: the failure, not "no project yet".
    open();
    expect(screen.getByText(/Something went wrong/)).toBeInTheDocument();
    expect(screen.queryByText(/There's no project/)).toBeNull();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });

  it("leaves someone else's files behind for a reader of their conversation", () => {
    open({ projectId: WEBSITE.id, viewerIsOwner: false });

    expect(screen.getByTestId('files')).toBeEmptyDOMElement();
  });

  it('reports the created task with a way to open it', async () => {
    const { user } = open({ projectId: WEBSITE.id });
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Task created in Website relaunch',
        variant: 'success',
      }),
    );
    const announced = state.toast.mock.calls[0]?.[0] as
      | { action: ReactElement<{ onClick: () => void }> }
      | undefined;
    if (announced === undefined) throw new Error('no toast');
    announced.action.props.onClick();
    expect(state.navigate).toHaveBeenCalledWith({
      to: '/dashboard/$id/projects/$projectId/tasks/board',
      params: { id: 'org-1', projectId: WEBSITE.id },
      search: { task: 'task-9' },
    });
  });

  it('groups projects by whether an agent can take the work, saying who could add one', async () => {
    state.projects = [
      { ...WEBSITE, agentCount: 2, canEdit: false },
      { ...HANDBOOK, agentCount: 0, canEdit: false },
      { id: 'p-ops', name: 'Operations', agentCount: 0, canEdit: true },
    ];
    const { user } = open();

    await user.click(screen.getByRole('button', { name: /^Project/ }));

    expect(screen.getByText('With an agent')).toBeInTheDocument();
    expect(screen.getByText('No agent yet')).toBeInTheDocument();
    expect(
      screen.getByRole('option', { name: /Website relaunch.*2 agents/ }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: /Employee handbook.*An Editor or Admin can add one/,
      }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('option', {
        name: /Operations.*You can add one in the task/,
      }),
    ).toBeInTheDocument();
  });

  it('picks the one project with an agent in advance', async () => {
    state.projects = [
      { ...WEBSITE, agentCount: 1 },
      { ...HANDBOOK, agentCount: 0 },
    ];
    const { user } = open();

    const next = screen.getByRole('button', { name: 'Continue' });
    expect(next).toBeEnabled();
    await user.click(next);

    expect(screen.getByTestId('project')).toHaveTextContent(WEBSITE.id);
  });

  it('takes a lone project without asking', () => {
    state.projects = [HANDBOOK];
    open();

    expect(screen.getByTestId('project')).toHaveTextContent(HANDBOOK.id);
  });

  it('hands the task to the project’s only agent, names the chat, and starts it', () => {
    state.agentsByProject = { [WEBSITE.id]: [{ _id: 'agent-1' }] };
    open({ projectId: WEBSITE.id });

    expect(screen.getByTestId('assignee')).toHaveTextContent('agent-1');
    expect(screen.getByTestId('source')).toHaveTextContent('t-root');
    expect(screen.getByTestId('start')).toHaveTextContent('true');
  });

  it('leaves the choice open between two agents', () => {
    state.agentsByProject = {
      [WEBSITE.id]: [{ _id: 'agent-1' }, { _id: 'agent-2' }],
    };
    open({ projectId: WEBSITE.id });

    expect(screen.getByTestId('assignee')).toBeEmptyDOMElement();
  });
});
