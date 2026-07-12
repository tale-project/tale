import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import { TaskTimeline } from './task-timeline';

// #2609: a run-admission refusal never creates a `taskAgentRuns` row, so it is
// recorded as a `taskActivity` row (`action: 'agent_run.refused'`, `toValue`
// the machine `refusedReason`) instead. The timeline must render it with a
// human-readable label, not the raw activity/reason codes.
vi.mock('../hooks/queries', () => ({
  useTaskActivity: () => ({
    activity: [
      {
        _id: 'activity_1',
        actorType: 'agent',
        actorId: 'issue-triager',
        action: 'agent_run.refused',
        toValue: 'agent_disabled',
        createdAt: Date.now(),
      },
    ],
  }),
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
    resolveActorPreview: () => null,
    resolveAgentRunPreview: () => null,
    resolveWorkflowRunPreview: () => null,
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatRelative: () => 'just now',
    formatDate: () => 'Jan 1, 2026',
  }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      const labels: Record<string, string> = {
        'detail.activity': 'Activity',
        'activity.agentRunRefused': 'Run refused',
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
        taskId={'task_1' as Id<'tasks'>}
        organizationId="org_1"
        projectId={'project_1' as Id<'projects'>}
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
