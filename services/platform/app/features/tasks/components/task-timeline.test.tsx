import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskActivityRow, TaskAgentRunRow } from '../utils/task-timeline';
import {
  TaskTimelineEntry,
  timelineItemKey,
  useTaskTimeline,
} from './task-timeline';

/** Every line of a task's history, each as the conversation draws it. */
function TaskTimeline({
  taskId,
  organizationId,
  projectId,
}: {
  taskId: string;
  organizationId: string;
  projectId: string;
}) {
  const { timeline, runs } = useTaskTimeline(taskId);
  return (
    <ul>
      {timeline.map((item) => (
        <li key={timelineItemKey(item)}>
          <TaskTimelineEntry
            item={item}
            runs={runs}
            organizationId={organizationId}
            projectId={projectId}
          />
        </li>
      ))}
    </ul>
  );
}

// Typed as the row the timeline actually consumes, so a fixture can carry any
// real `actorType` and the shape cannot drift from `TaskActivityRow`.
const timelineMocks: { activity: TaskActivityRow[]; runs: TaskAgentRunRow[] } =
  {
    runs: [],
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
  useTaskAgentRuns: () => ({ runs: timelineMocks.runs }),
}));

vi.mock('@/app/features/automations/components/agent-execution-log', () => ({
  ExecutionLogView: () => <div data-testid="execution-log" />,
}));

const sandboxOp = vi.hoisted(() => ({
  value: null as unknown,
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: sandboxOp.value,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: () => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name:
        (
          {
            'issue-triager': 'Issue Triager',
            'agent-manager': 'Fleet manager',
            'agent-worker': 'Implementer',
          } as Record<string, string>
        )[id] ?? id,
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
    resolveAgentRunPreview: (run: { agentSlug: string }) => ({
      kind: 'agent',
      name:
        run.agentSlug === 'agent-worker'
          ? 'Implementer'
          : run.agentSlug === 'agent-deleted'
            ? 'Deleted agent'
            : run.agentSlug,
      viewTo: '/dashboard/$id',
      viewParams: { id: 'org_1' },
    }),
    resolveWorkflowRunPreview: (run: {
      workflowSlug?: string;
      wfExecutionId?: string;
    }) =>
      run.workflowSlug === undefined
        ? null
        : {
            kind: 'workflow',
            name: 'Fleet manager cycle',
            viewTo: '/dashboard/$id/automations/$automationSlug',
            viewParams: { id: 'org_1', automationSlug: run.workflowSlug },
            viewSearch: { execution: run.wfExecutionId },
          },
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
        'activity.repeatChanged': 'Repeat changed',
        'activity.repeatNext': 'Next task created',
        never: 'Never',
        'agentRuns.refused.agent_disabled':
          'agent is not installed or is disabled',
        'timeline.runLabel': 'Agent run',
        'actions.view': 'View',
        'timeline.hideExecution': 'Hide',
        'timeline.toolActions': `${String(values?.count)} tool actions`,
        'timeline.deletedAgent': 'Deleted agent',
        'timeline.startedByAgent': 'started by',
        'agentRuns.trigger.automation': 'automation',
        'agentRuns.trigger.delegated': 'delegated',
        'agentRuns.trigger.manual': 'manual',
        'agentRuns.status.settled': 'settled',
        'agentRuns.totalCost': `${String(values?.amount)} total`,
        'agentRun.waiting.org_limit': 'Waiting for a worker',
        'agentRun.waitingWhy.org_limit':
          "All of your organization's agent workers are busy.",
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

  it('labels an assignee whose historical agent was deleted', () => {
    timelineMocks.runs = [
      {
        runId: 'run_old' as string,
        agentSlug: 'agent-deleted',
        trigger: 'manual',
        status: 'failed',
        startedAt: Date.now(),
        costCents: 0,
      },
    ];
    timelineMocks.activity = [
      {
        _id: 'activity_deleted_agent' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'assignee.changed',
        fromValue: 'agent-deleted',
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
      screen.getByText(/assignee changed: Deleted agent/i),
    ).toBeInTheDocument();
    expect(screen.queryByText('agent-deleted')).not.toBeInTheDocument();
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

  // A repeat change stores each rule as JSON and "no rule" as an absent end;
  // both ends read as words, so setting and stopping a series each say so.
  it('names both ends of a repeat.changed row, an absent one as "Never"', () => {
    const monthly = JSON.stringify({
      frequency: 'monthly',
      interval: 1,
      monthDay: 15,
      timezone: 'Europe/Zurich',
    });
    timelineMocks.activity = [
      {
        _id: 'activity_repeat_set' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'repeat.changed',
        toValue: monthly,
        createdAt: Date.now(),
      },
      {
        _id: 'activity_repeat_stopped' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'repeat.changed',
        // A zone this runtime no longer knows still names the rule.
        fromValue: JSON.stringify({
          frequency: 'daily',
          interval: 2,
          timezone: 'Mars/Olympus_Mons',
        }),
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
        'Repeat changed: Never → sentence.monthly({"count":1,"day":15})',
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Repeat changed: sentence.daily({"count":2}) → Never'),
    ).toBeInTheDocument();
  });

  // The rule stays, only when its next task is created changes: the row
  // still reads as a change, the new end naming the due-date mode.
  it('names a change of the creation mode alone', () => {
    const monthly = {
      frequency: 'monthly',
      interval: 1,
      monthDay: 30,
      timezone: 'Europe/Zurich',
    };
    timelineMocks.activity = [
      {
        _id: 'activity_repeat_mode' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'repeat.changed',
        fromValue: JSON.stringify(monthly),
        toValue: JSON.stringify({ ...monthly, createOn: 'dueDate' }),
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

    // The stub `t` echoes a key with its values.
    const sentence = 'sentence.monthly({"count":1,"day":30})';
    const onDue = `repeat.ruleOnDue(${JSON.stringify({ rule: sentence })})`;
    expect(
      screen.getByText(`Repeat changed: ${sentence} → ${onDue}`),
    ).toBeInTheDocument();
  });

  it('names the copy a repeat.next row points to', () => {
    timelineMocks.activity = [
      {
        _id: 'activity_repeat_next' as string,
        actorType: 'user',
        actorId: 'user-actor',
        action: 'repeat.next',
        toValue: 'OPS-12',
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

    expect(screen.getByText('Next task created: OPS-12')).toBeInTheDocument();
  });
});

describe('TaskTimeline — runs no person started', () => {
  beforeEach(() => {
    timelineMocks.activity = [];
    timelineMocks.runs = [];
    sandboxOp.value = null;
  });

  it('names the automation run that started an agent run', () => {
    timelineMocks.runs = [
      {
        runId: 'run_1',
        agentSlug: 'agent-worker',
        trigger: 'automation',
        status: 'running',
        startedAt: Date.now(),
        costCents: 0,
        workflowSlug: 'autonomous-cycle/fleet-manager',
        wfExecutionId: 'automation_run_1',
      },
    ];
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );
    expect(screen.getByText('automation')).toBeInTheDocument();
    expect(screen.getByText('Fleet manager cycle')).toBeInTheDocument();
    expect(screen.queryByText(/started by/)).not.toBeInTheDocument();
  });

  it('shows an explicit execution control and its compact run metadata', async () => {
    const user = userEvent.setup();
    timelineMocks.runs = [
      {
        runId: 'run_completed',
        agentSlug: 'agent-worker',
        trigger: 'manual',
        status: 'settled',
        startedAt: Date.now(),
        durationMs: 14 * 60 * 1000,
        costCents: 12,
      },
    ];
    sandboxOp.value = {
      status: 'completed',
      execId: 'exec-1',
      liveTimeline: [
        { type: 'tool-Bash', toolCallId: 'tool-1' },
        { type: 'tool-Read', toolCallId: 'tool-2' },
      ],
    };

    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );

    const viewButton = screen.getByRole('button', { name: 'View' });
    expect(viewButton).toHaveAttribute('aria-expanded', 'false');
    await user.click(viewButton);
    expect(screen.getByRole('button', { name: 'Hide' })).toHaveAttribute(
      'aria-expanded',
      'true',
    );
    expect(screen.getAllByText('settled')).not.toHaveLength(0);
    expect(screen.getByText('14m')).toBeInTheDocument();
    expect(screen.getByText('2 tool actions')).toBeInTheDocument();
    expect(screen.getByText('0.12 total')).toBeInTheDocument();
    expect(screen.getByTestId('execution-log')).toBeInTheDocument();
    await user.click(viewButton);
    expect(viewButton).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByTestId('execution-log')).not.toBeInTheDocument();
  });

  it('names the agent whose run started a delegated one', () => {
    timelineMocks.runs = [
      {
        runId: 'run_2',
        agentSlug: 'agent-worker',
        trigger: 'delegated',
        status: 'running',
        startedAt: Date.now(),
        costCents: 0,
        delegatedByAgentId: 'agent-manager',
      },
    ];
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );
    expect(screen.getByText('delegated')).toBeInTheDocument();
    expect(screen.getByText(/started by/)).toBeInTheDocument();
    expect(screen.getByText('Fleet manager')).toBeInTheDocument();
  });

  it('says why a waiting run waits, on its own line under the run', () => {
    timelineMocks.runs = [
      {
        runId: 'run_4',
        agentSlug: 'agent-worker',
        trigger: 'manual',
        status: 'queued',
        waitingForCapacity: true,
        waitingReason: 'org_limit',
        startedAt: Date.now(),
        costCents: 0,
      },
    ];
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );
    expect(screen.getByText('Waiting for a worker')).toBeInTheDocument();
    expect(
      screen.getByText("All of your organization's agent workers are busy."),
    ).toBeInTheDocument();
    expect(screen.queryByText('agentRuns.status.queued')).toBeNull();
  });

  it('names neither for a run a person started', () => {
    timelineMocks.runs = [
      {
        runId: 'run_3',
        agentSlug: 'agent-worker',
        trigger: 'manual',
        status: 'running',
        startedAt: Date.now(),
        costCents: 0,
      },
    ];
    render(
      <TaskTimeline
        taskId={'task_1' as string}
        organizationId="org_1"
        projectId={'project_1' as string}
      />,
    );
    expect(screen.getByText('manual')).toBeInTheDocument();
    expect(screen.queryByText(/started by/)).not.toBeInTheDocument();
    expect(screen.queryByText('Fleet manager cycle')).not.toBeInTheDocument();
  });
});
