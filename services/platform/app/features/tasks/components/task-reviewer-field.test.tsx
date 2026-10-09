// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskReviewerState } from '@/app/lib/backend/contract/tasks';
import { AppError } from '@/lib/shared/errors/app-error';
import { act, render, screen, waitFor } from '@/tests/utils/render';

import { TaskReviewerField } from './task-reviewer-field';

const mocks = vi.hoisted(() => ({
  data: undefined as TaskReviewerState | undefined,
  queryClient: undefined as QueryClient | undefined,
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
vi.mock('../hooks/mutations', async () => {
  const { useMutation } = await import('@tanstack/react-query');
  return {
    useSetTaskReviewer: () =>
      useMutation(
        { mutationFn: (args: unknown) => mocks.mutate(args) },
        mocks.queryClient,
      ),
  };
});
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
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
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
  mocks.queryClient = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
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
  it.each(['success', 'failure'] as const)(
    'keeps the same keyboard focus target through a delayed %s save',
    async (outcome) => {
      const pending = Promise.withResolvers<null>();
      mocks.mutate.mockReturnValueOnce(pending.promise);
      const { user } = render(<TaskReviewerField task={task} canEdit />);
      const closed = screen.getByRole('button', { name: 'Reviewer' });
      await user.tab();
      expect(closed).toHaveFocus();
      await user.keyboard('{Enter}');
      await user.type(screen.getByRole('combobox'), 'Review agent');
      await user.keyboard('{ArrowDown}{Enter}');
      await waitFor(() => expect(mocks.mutate).toHaveBeenCalledTimes(1));

      // Its first use mounted the list in place of the closed trigger; from
      // there on the list's trigger is the one focus target, through the save.
      const trigger = screen.getByRole('button', { name: 'Reviewer' });
      expect(trigger).toHaveAttribute('aria-disabled', 'true');
      expect(trigger).toHaveAttribute('aria-busy', 'true');
      expect(trigger).not.toBeDisabled();
      await waitFor(() => expect(trigger).toHaveFocus());
      await user.keyboard('{Enter} ');
      await user.click(trigger);
      expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
      expect(mocks.mutate).toHaveBeenCalledTimes(1);

      await act(async () => {
        if (outcome === 'success') pending.resolve(null);
        else pending.reject(new AppError({ code: 'TASK_REVIEWER_STALE' }));
      });
      await waitFor(() =>
        expect(trigger).not.toHaveAttribute('aria-disabled', 'true'),
      );
      expect(screen.getByRole('button', { name: 'Reviewer' })).toBe(trigger);
      expect(trigger).toHaveFocus();
      expect(mocks.mutate).toHaveBeenCalledTimes(1);
      expect(mocks.refetch).toHaveBeenCalledTimes(
        outcome === 'failure' ? 1 : 0,
      );
      expect(mocks.toast).toHaveBeenCalledTimes(outcome === 'failure' ? 1 : 0);
      await user.keyboard('{Enter}');
      expect(screen.getByRole('combobox')).toBeInTheDocument();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(trigger).toHaveFocus());
    },
  );

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
        screen.getByRole('button', { name: 'Reviewer' }),
      ).toHaveTextContent('Review agent');
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
    expect(screen.getByRole('button', { name: 'Reviewer' })).toHaveTextContent(
      'Alice',
    );
    expect(
      screen.queryByText(
        'This agent needs the task review permission before it can decide.',
      ),
    ).not.toBeInTheDocument();
  });
  it('keeps the current review distinct from the project default and transfers its exact identity', async () => {
    const { user } = render(<TaskReviewerField task={task} canEdit />);
    expect(screen.getByRole('button', { name: 'Reviewer' })).toHaveTextContent(
      'Alice',
    );
    expect(
      screen.queryByText('Project default · Review agent'),
    ).not.toBeInTheDocument();
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

  it('shows the inherited person in the clickable field and explains routing only when opened', async () => {
    if (!mocks.data) throw new Error('Missing reviewer fixture');
    mocks.data.projectReviewer = { kind: 'human_default' };
    const { user } = render(<TaskReviewerField task={task} canEdit />);
    expect(screen.getByRole('button', { name: 'Reviewer' })).toHaveTextContent(
      'Alice',
    );
    expect(
      screen.queryByText('Project default · person'),
    ).not.toBeInTheDocument();
    expect(screen.queryByText('Current review: Alice')).not.toBeInTheDocument();
    const hint = 'Choosing a reviewer also transfers this pending review.';
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    await user.click(screen.getByText('Alice'));
    expect(
      screen.getByRole('option', { name: 'Project default · person' }),
    ).toBeInTheDocument();
    expect(screen.getByText(hint)).toBeInTheDocument();
    await user.keyboard('{Escape}');
    await user.click(screen.getByText('Alice'));
    expect(screen.getByRole('combobox')).toBeInTheDocument();
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
