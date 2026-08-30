// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { TaskRunFailureBanner } from './task-run-failure-banner';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
    ...rest
  }: {
    children: React.ReactNode;
    to: string;
  }) => (
    <a href={to} {...rest}>
      {children}
    </a>
  ),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'runFailure.title': "Agent couldn't start this task",
        'runFailure.viewAgents': 'Manage agents',
      };
      if (key === 'runFailure.description') {
        return `${String(values?.agent)} could not start: ${String(values?.reason)}.`;
      }
      return labels[key] ?? key;
    },
  }),
}));

interface MockActivity {
  _id: string;
  actorType: 'user' | 'agent';
  actorId: string;
  action: string;
  toValue?: string;
  createdAt: number;
}

let mockActivity: MockActivity[] = [];
let mockRuns: Array<{
  runId: string;
  agentSlug: string;
  trigger: string;
  status: string;
  startedAt: number;
  costCents: number;
}> = [];

vi.mock('../hooks/queries', () => ({
  useTaskActivity: () => ({ activity: mockActivity }),
  useTaskAgentRuns: () => ({ runs: mockRuns }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (_type: string, id: string) => ({
      name: id === 'issue-triager' ? 'Issue Triager' : id,
    }),
  }),
}));

describe('TaskRunFailureBanner (#2609)', () => {
  it('renders nothing when the latest timeline entry is not a refusal', () => {
    mockActivity = [
      {
        _id: 'a1',
        actorType: 'user',
        actorId: 'user_1',
        action: 'created',
        createdAt: 100,
      },
    ];
    mockRuns = [];

    render(
      <TaskRunFailureBanner
        taskId={'task_1' as string}
        organizationId="org_1"
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('surfaces the refusal as a primary banner when it is the latest activity', () => {
    mockActivity = [
      {
        _id: 'a1',
        actorType: 'agent',
        actorId: 'issue-triager',
        action: 'agent_run.refused',
        toValue: 'agent_disabled',
        createdAt: 200,
      },
    ];
    mockRuns = [];

    render(
      <TaskRunFailureBanner
        taskId={'task_1' as string}
        organizationId="org_1"
      />,
    );

    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(
      screen.getByText(/Issue Triager could not start/),
    ).toBeInTheDocument();
    // The agents management page was removed, so the banner no longer offers a
    // "Manage agents" link.
    expect(screen.queryByRole('link', { name: 'Manage agents' })).toBeNull();
  });

  it('clears once a newer activity supersedes the refusal', () => {
    mockActivity = [
      {
        _id: 'a1',
        actorType: 'agent',
        actorId: 'issue-triager',
        action: 'agent_run.refused',
        toValue: 'agent_disabled',
        createdAt: 200,
      },
      {
        _id: 'a2',
        actorType: 'user',
        actorId: 'user_1',
        action: 'assignee.changed',
        createdAt: 300,
      },
    ];
    mockRuns = [];

    render(
      <TaskRunFailureBanner
        taskId={'task_1' as string}
        organizationId="org_1"
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
