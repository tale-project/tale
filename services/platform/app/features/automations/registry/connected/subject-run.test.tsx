// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SubjectRun } from './subject-run';

// i18n → echo `<ns>.<key>`.
vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('../../runtime/automation-runtime', () => ({
  useAutomationRuntime: () => ({ organizationId: 'org_1' }),
}));

vi.mock('./subject-input-panel', () => ({
  SubjectInputPanel: () => null,
}));

// The operator run view is out of scope — it only has to mount the
// `beforeDetails` slot, where the comment thread lives.
vi.mock('@/app/features/operator/components/embedded-run', () => ({
  EmbeddedRun: ({ beforeDetails }: { beforeDetails?: ReactNode }) => (
    <div data-testid="embedded-run">{beforeDetails}</div>
  ),
}));

// The shared comments surface — stubbed to capture the props this seam hands it.
const taskCommentsCalls: Record<string, unknown>[] = [];
vi.mock('@/app/features/tasks/components/task-comments', () => ({
  TaskComments: (props: Record<string, unknown>) => {
    taskCommentsCalls.push(props);
    return <div data-testid="task-comments" />;
  },
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTask: () => ({
    task: { _id: 'task_1', organizationId: 'org_1', projectId: 'proj_1' },
    canComment: true,
  }),
  useTaskDiscussion: () => ({ comments: [] }),
}));

vi.mock('@/app/hooks/use-current-member-context', () => ({
  useCurrentMemberContext: () => ({
    data: { userId: 'user_1', isAdmin: false },
  }),
}));

// The subject's latest run — tests flip the status per case.
let latestRunReturn: { data: unknown; isLoading: boolean } = {
  data: null,
  isLoading: false,
};
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => latestRunReturn,
}));

afterEach(() => {
  taskCommentsCalls.length = 0;
  latestRunReturn = { data: null, isLoading: false };
});

const runWithStatus = (status: string) => ({
  data: { executionId: 'exec_1', status, startedAt: 1 },
  isLoading: false,
});

describe('SubjectRun comment composer hint', () => {
  it("warns at the composer while the subject's latest run is active", () => {
    latestRunReturn = runWithStatus('running');

    render(<SubjectRun subjectType="task" subjectId="task_1" />);

    expect(taskCommentsCalls).toHaveLength(1);
    expect(taskCommentsCalls[0]).toMatchObject({
      taskId: 'task_1',
      composerHint: 'automations.detail.commentsDuringRun',
    });
  });

  it('passes no hint once the run settled', () => {
    latestRunReturn = runWithStatus('completed');

    render(<SubjectRun subjectType="task" subjectId="task_1" />);

    expect(taskCommentsCalls).toHaveLength(1);
    expect(taskCommentsCalls[0]?.composerHint).toBeUndefined();
  });

  it('passes no hint when the subject has no run yet', () => {
    render(<SubjectRun subjectType="task" subjectId="task_1" />);

    // Without a run to embed, the thread still renders after the placeholder.
    expect(screen.getByText('automations.runs.none')).toBeInTheDocument();
    expect(taskCommentsCalls).toHaveLength(1);
    expect(taskCommentsCalls[0]?.composerHint).toBeUndefined();
  });
});
