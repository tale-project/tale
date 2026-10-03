// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskReviewerState } from '@/app/lib/backend/contract/tasks';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

import { TaskReviewerField } from './task-reviewer-field';

const mocks = vi.hoisted(() => ({
  data: undefined as TaskReviewerState | undefined,
  isError: false,
  mutate: vi.fn(),
  refetch: vi.fn(),
  toast: vi.fn(),
}));
vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: mocks.data,
    isError: mocks.isError,
    refetch: mocks.refetch,
  }),
}));
vi.mock('../hooks/mutations', () => ({
  useSetTaskReviewer: () => ({ mutateAsync: mocks.mutate, isPending: false }),
}));
vi.mock('@tale/ui/use-toast', () => ({ toast: mocks.toast }));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProjectAgents: () => ({
    agents: [{ _id: 'reviewer', name: 'Review agent', tools: [] }],
    isLoading: false,
  }),
}));
const names: Record<string, string> = {
  reviewer: 'Review agent',
  worker: 'Worker',
  alice: 'Alice',
};
const resolveActor = (type: string, id: string) => ({
  type,
  id,
  name: names[id] ?? id,
  isAgent: type === 'agent',
});
vi.mock('../hooks/use-actor-directory', () => ({
  useActorDirectory: () => ({ resolveActor }),
  useAssignableActors: () => ({
    scopeReady: true,
    agentsLoading: false,
    currentUserId: 'alice',
    resolveActor,
    assignableMembers: [
      { type: 'user', id: 'alice', name: 'Alice', role: 'editor' },
    ],
    assignableAgents: [
      {
        type: 'agent',
        id: 'reviewer',
        name: 'Review agent',
        tools: ['task_review'],
      },
      { type: 'agent', id: 'worker', name: 'Worker', tools: ['task_review'] },
    ],
  }),
}));
const task = {
  _id: 'task-1',
  organizationId: 'org-1',
  projectId: 'project-1',
  assigneeType: 'agent' as const,
  assigneeId: 'worker',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.isError = false;
  mocks.mutate.mockResolvedValue(null);
  mocks.refetch.mockResolvedValue(null);
  mocks.data = {
    reviewer: { kind: 'inherit' },
    projectReviewer: { kind: 'agent', agentId: 'reviewer' },
    pendingReview: {
      approvalId: 'approval-1',
      taskId: 'task-1',
      round: 1,
      requestedFor: 'alice',
      reviewer: { kind: 'user', userId: 'alice' },
      runId: 'run-1',
      agentSlug: 'Worker display label',
      implementationAgentId: 'worker',
      evidenceRevision: 'a'.repeat(64),
      agentReviewBlockedReason: null,
      createdAt: 1,
    },
  };
});

describe('TaskReviewerField', () => {
  it('keeps the identity observed when the picker opened across a newer review arriving', async () => {
    const { user, rerender } = render(
      <TaskReviewerField task={task} canEdit />,
    );
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    if (!mocks.data?.pendingReview) throw new Error('Missing review fixture');
    mocks.data = {
      ...mocks.data,
      pendingReview: {
        ...mocks.data.pendingReview,
        approvalId: 'newer-approval',
        runId: 'newer-run',
      },
    };
    rerender(<TaskReviewerField task={task} canEdit />);
    await user.click(screen.getByRole('option', { name: /^Review agent/ }));
    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith(
        expect.objectContaining({
          expected: {
            reviewer: { kind: 'inherit' },
            pendingReview: {
              approvalId: 'approval-1',
              runId: 'run-1',
              reviewer: { kind: 'user', userId: 'alice' },
            },
          },
        }),
      ),
    );
  });
  it.each([
    ['self_review', 'Choose an agent that did not produce this result.'],
    [
      'human_policy',
      'Organization policy requires a person for this review. Transfer it to an eligible member.',
    ],
    [
      'policy_unavailable',
      'Review policy could not be read. Restore valid organization policy before deciding.',
    ],
  ] as const)(
    'explains the captured %s block without granting permission or retrying',
    (reason, message) => {
      if (!mocks.data?.pendingReview) throw new Error('Missing review fixture');
      mocks.data.pendingReview.reviewer = {
        kind: 'agent',
        agentId: 'reviewer',
      };
      mocks.data.pendingReview.agentReviewBlockedReason = reason;
      render(<TaskReviewerField task={task} canEdit />);
      expect(screen.getByRole('status')).toHaveTextContent(message);
      expect(
        screen.getByText('Current review: Review agent'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText(
          'This agent needs the task review permission before it can decide.',
        ),
      ).not.toBeInTheDocument();
      expect(mocks.mutate).not.toHaveBeenCalled();
    },
  );

  it('does not describe a future agent permission as a block on the captured human review', () => {
    render(<TaskReviewerField task={task} canEdit />);
    expect(screen.getByText('Current review: Alice')).toBeInTheDocument();
    expect(
      screen.queryByText(
        'This agent needs the task review permission before it can decide.',
      ),
    ).not.toBeInTheDocument();
  });
  it('keeps the current review distinct from the project default and transfers its exact identity', async () => {
    const { user } = render(<TaskReviewerField task={task} canEdit />);
    expect(screen.getByText('Current review: Alice')).toBeInTheDocument();
    expect(
      screen.getByText('Project default · Review agent'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    await user.click(screen.getByRole('option', { name: /^Review agent/ }));
    await waitFor(() =>
      expect(mocks.mutate).toHaveBeenCalledWith({
        taskId: 'task-1',
        reviewer: { kind: 'agent', agentId: 'reviewer' },
        expected: {
          reviewer: { kind: 'inherit' },
          pendingReview: {
            approvalId: 'approval-1',
            runId: 'run-1',
            reviewer: { kind: 'user', userId: 'alice' },
          },
        },
      }),
    );
  });

  it('reports a stale decision once and reloads instead of retrying a handoff automatically', async () => {
    mocks.mutate.mockRejectedValue(
      new AppError({ code: 'TASK_REVIEWER_STALE' }),
    );
    const { user } = render(<TaskReviewerField task={task} canEdit />);
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    await user.click(screen.getByRole('option', { name: /^Review agent/ }));
    await waitFor(() => expect(mocks.refetch).toHaveBeenCalledTimes(1));
    expect(mocks.mutate).toHaveBeenCalledTimes(1);
    expect(mocks.toast).toHaveBeenCalledExactlyOnceWith({
      title:
        'The reviewer or result changed. Check the current review and choose again.',
      variant: 'destructive',
    });
  });

  it('excludes the source agent even when the task has since been reassigned', async () => {
    const { user } = render(
      <TaskReviewerField task={{ ...task, assigneeId: 'reviewer' }} canEdit />,
    );
    await user.click(screen.getByRole('button', { name: 'Reviewer' }));
    expect(screen.getByRole('option', { name: /^Worker/ })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    expect(
      screen.getByRole('option', { name: /^Review agent/ }),
    ).not.toHaveAttribute('aria-disabled', 'true');
  });

  it('makes a failed initial read retryable without offering an unsafe edit', async () => {
    mocks.data = undefined;
    mocks.isError = true;
    const { user } = render(<TaskReviewerField task={task} canEdit />);
    expect(
      screen.queryByRole('button', { name: 'Reviewer' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
    expect(mocks.mutate).not.toHaveBeenCalled();
  });

  it('discloses a missing review grant without granting it or starting a run', () => {
    mocks.data = {
      reviewer: { kind: 'agent', agentId: 'reviewer' },
      projectReviewer: { kind: 'human_default' },
      pendingReview: null,
    };
    render(<TaskReviewerField task={task} canEdit={false} />);
    expect(
      screen.getByText(
        'This agent needs the task review permission before it can decide.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Reviewer' }),
    ).not.toBeInTheDocument();
    expect(mocks.mutate).not.toHaveBeenCalled();
  });
});
