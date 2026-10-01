// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { ChatTaskTray } from './chat-task-tray';

const state = vi.hoisted(() => ({
  tasks: { status: 'ready', data: [] } as
    | { status: 'ready'; data: unknown[] }
    | { status: 'loading' }
    | { status: 'unavailable' },
}));

vi.mock('../data/chat-backend', () => ({
  useChatQuery: () => state.tasks,
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    search,
    params,
    ...rest
  }: {
    children: React.ReactNode;
    search: { task: string };
    params: { projectId: string };
  }) => (
    <a
      href={`/projects/${params.projectId}/tasks/board?task=${search.task}`}
      {...rest}
    >
      {children}
    </a>
  ),
}));

function task(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    projectId: 'proj-1',
    projectName: 'Website relaunch',
    title: `Task ${id}`,
    status: 'in_progress',
    assigneeType: 'agent',
    assigneeId: 'agent-1',
    outputCount: 0,
    ...overrides,
  };
}

function renderTray() {
  return render(<ChatTaskTray organizationId="org-1" threadId="thread-1" />);
}

beforeEach(() => {
  state.tasks = { status: 'ready', data: [] };
});

describe('ChatTaskTray', () => {
  it('shows nothing while the chat handed nothing over, or the read fails', () => {
    const { container, rerender } = renderTray();
    expect(container).toBeEmptyDOMElement();

    state.tasks = { status: 'unavailable' };
    rerender(<ChatTaskTray organizationId="org-1" threadId="thread-1" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('says what each task is doing now, and where to open it', () => {
    state.tasks = {
      status: 'ready',
      data: [
        task('a', { run: { status: 'running' } }),
        task('b', {
          run: { status: 'queued', waitingForCapacity: true },
        }),
        task('c', {
          run: { status: 'failed', failureCode: 'budget_exceeded' },
        }),
      ],
    };
    renderTray();

    const region = screen.getByRole('region', { name: 'Tasks from this chat' });
    const rows = within(region).getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent(
      'The agent is working · Website relaunch',
    );
    expect(rows[1]).toHaveTextContent('Waiting for a sandbox slot');
    expect(rows[2]).toHaveTextContent("The agent couldn't finish");
    expect(
      screen.getByRole('link', { name: 'Open task Task c' }),
    ).toHaveAttribute('href', '/projects/proj-1/tasks/board?task=c');
  });

  it('reads a failure about to be retried as a retry, not a stop', () => {
    state.tasks = {
      status: 'ready',
      data: [task('a', { run: { status: 'failed', retryPending: true } })],
    };
    renderTray();

    expect(screen.getByRole('listitem')).toHaveTextContent('Trying again…');
  });

  it('counts the files a task delivered for review', () => {
    state.tasks = {
      status: 'ready',
      data: [
        task('a', { status: 'in_review', outputCount: 2 }),
        task('b', { status: 'in_review', outputCount: 0 }),
        task('c', { status: 'done' }),
      ],
    };
    renderTray();

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Ready for review · 2 files');
    expect(rows[1]).toHaveTextContent('Ready for review');
    expect(rows[2]).toHaveTextContent('Done');
  });

  it('says an assigned agent has not been started, and names a person’s task by its column', () => {
    state.tasks = {
      status: 'ready',
      data: [
        task('a', { status: 'todo' }),
        task('b', { status: 'todo', assigneeType: 'user' }),
      ],
    };
    renderTray();

    const rows = screen.getAllByRole('listitem');
    expect(rows[0]).toHaveTextContent('Waiting to be started');
    expect(rows[1]).toHaveTextContent('To do');
  });

  it('shows the newest three and counts the rest', () => {
    state.tasks = {
      status: 'ready',
      data: ['a', 'b', 'c', 'd', 'e'].map((id) => task(id)),
    };
    renderTray();

    expect(screen.getAllByRole('listitem')).toHaveLength(3);
    expect(screen.getByText('and 2 more tasks')).toBeInTheDocument();
  });
});
