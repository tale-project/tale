import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskActivityRow } from '../utils/task-timeline';
import { TaskTimeline } from './task-timeline';

// Typed as the row the timeline actually consumes, so a fixture can carry any
// real `actorType` and the shape cannot drift from `TaskActivityRow`.
const timelineMocks: { activity: TaskActivityRow[] } = {
  activity: [
    {
      _id: 'activity_1' as string,
      actorType: 'agent',
      actorId: 'issue-triager',
      action: 'agent_run.refused',
      toValue: 'agent_disabled',
      createdAt: Date.now(),
    },
  ],
};

vi.mock('../hooks/queries', () => ({
  useTaskActivity: () => ({ activity: timelineMocks.activity }),
  useTaskAgentRuns: () => ({ runs: [] }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name: id === 'issue-triager' ? 'Issue Triager' : id,
      isAgent: type === 'agent',
    }),
    resolveAssigneeId: (id: string) =>
      (
        ({
          'user-old': 'Alex Doe',
          'user-new': 'Kim Lee',
        }) as Record<string, string>
      )[id] ?? id,
    resolveActorPreview: () => null,
    resolveAgentRunPreview: () => null,
    resolveWorkflowRunPreview: () => null,
  }),
}));

vi.mock('@tale/ui/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
  }),
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'detail.activity': 'Activity',
        'activity.agentRunRefused': 'Run refused',
        'activity.assigneeChanged': 'Assignee changed',
        'activity.titleChanged': 'Title changed',
        'activity.priorityChanged': 'Priority changed',
        'priority.p0': 'Urgent',
        'priority.p1': 'High',
        'priority.p2': 'Medium',
        'priority.p3': 'Low',
        'priority.none': 'No priority',
        'agentRuns.refused.agent_disabled':
          'agent is not installed or is disabled',
      };
      return (
        labels[key] ?? (values ? `${key}(${JSON.stringify(values)})` : key)
      );
    },
  }),
}));

describe('TaskTimeline — admission refusal activity (#2609)', () => {
  it('renders the refusal reason in plain language, not the raw action/reason codes', () => {
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    expect(screen.getByText('Issue Triager')).toBeInTheDocument();
    expect(
      screen.getByText(/run refused: agent is not installed or is disabled/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/agent_run\.refused/)).not.toBeInTheDocument();
    expect(screen.queryByText(/agent_disabled/)).not.toBeInTheDocument();
  });
});

describe('TaskTimeline — assignee change activity', () => {
  beforeEach(() => {
    timelineMocks.activity = [
      {
        _id: 'activity_2' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'assignee.changed',
        fromValue: 'user-old',
        toValue: 'user-new',
        createdAt: Date.now(),
      },
    ];
  });

  it('renders assignee names instead of raw ids', () => {
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    expect(
      screen.getByText(/assignee changed: Alex Doe → Kim Lee/i),
    ).toBeInTheDocument();
    expect(screen.queryByText(/user-old/)).not.toBeInTheDocument();
    expect(screen.queryByText(/user-new/)).not.toBeInTheDocument();
  });
});

describe('TaskTimeline — editor activity rows surface what changed', () => {
  it('renders an old → new title for a title.changed row', () => {
    timelineMocks.activity = [
      {
        _id: 'activity_title' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'title.changed',
        fromValue: 'Tie the room together',
        toValue: 'Tie the whole room together',
        createdAt: Date.now(),
      },
    ];

    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    expect(
      screen.getByText(
        /title changed: Tie the room together → Tie the whole room together/i,
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/TASK_ACTIVITY_LABEL_KEY|enqueued/i),
    ).not.toBeInTheDocument();
  });

  it('renders both ends of a priority.changed row using the priority labels', () => {
    timelineMocks.activity = [
      {
        _id: 'activity_priority' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'priority.changed',
        fromValue: 'p2',
        toValue: 'p0',
        createdAt: Date.now(),
      },
    ];

    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    expect(
      screen.getByText(/priority changed: Medium → Urgent/i),
    ).toBeInTheDocument();
  });

  it('shows "No priority" when priority is cleared (empty toValue)', () => {
    timelineMocks.activity = [
      {
        _id: 'activity_priority_cleared' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'priority.changed',
        fromValue: 'p0',
        toValue: '',
        createdAt: Date.now(),
      },
    ];

    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    expect(
      screen.getByText(/priority changed: Urgent → No priority/i),
    ).toBeInTheDocument();
  });
});
