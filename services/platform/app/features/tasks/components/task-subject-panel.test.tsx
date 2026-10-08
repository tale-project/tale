// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { TaskSubjectContract } from '@tale/shared/schemas/task-contract';
import { toast } from '@tale/ui/use-toast';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { TaskReviewerState } from '@/app/lib/backend/contract/tasks';
import { AppError } from '@/lib/shared/errors/app-error';
import { render, screen, waitFor } from '@/tests/utils/render';

import {
  type ResolvedTaskSubjectContract,
  resolveTaskSubjectContract,
} from '../hooks/use-task-subject-contract';

// The panel's whole job is to answer, on the first screen of an
// automation-owned task: WHO owns it, WHAT it is, WHAT NOW, WHAT TO PRESS.
// Pinned here against the two states a reader meets before anything runs —
// waiting for input and ready — because the failure this locks out is a state
// that TALKS about starting while offering nothing to start.

const mocks = vi.hoisted(() => ({
  run: null as unknown,
  runError: false,
  runFetching: false,
  refetchRun: vi.fn(),
  pendingAsk: null as unknown,
  inDoubt: null as unknown,
  resolveInDoubt: vi.fn(),
  reviewer: undefined as TaskReviewerState | undefined,
  reviewerError: false,
  refetchReviewer: vi.fn(),
  start: vi.fn(),
  cancel: vi.fn(),
  updateStatus: vi.fn(),
  addComment: vi.fn(),
  answerAsk: vi.fn(),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (query: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined };
    if (query === 'tasks/queries:getTaskReviewer') {
      return {
        data: mocks.reviewer,
        isError: mocks.reviewerError,
        refetch: mocks.refetchReviewer,
      };
    }
    if (query === 'automations/human_asks:getPendingAskForRun') {
      return { data: mocks.pendingAsk };
    }
    if (query === 'automations/queries:getRunInDoubt') {
      return { data: mocks.inDoubt, isError: false, refetch: vi.fn() };
    }
    return {
      data: mocks.run,
      isError: mocks.runError,
      isFetching: mocks.runFetching,
      error: mocks.runError ? new Error('503') : null,
      refetch: mocks.refetchRun,
    };
  },
}));

vi.mock('@/app/hooks/use-backend-action', () => {
  return {
    useBackendAction: (action: unknown) => ({
      mutateAsync:
        action === 'tasks/public_actions:cancelTaskWorkflow'
          ? mocks.cancel
          : mocks.start,
    }),
  };
});

vi.mock('../hooks/mutations', () => ({
  useUpdateTaskStatus: () => ({ mutateAsync: mocks.updateStatus }),
  useAddTaskComment: () => ({ mutateAsync: mocks.addComment }),
}));

vi.mock('@/app/features/automations/hooks/mutations', () => ({
  useAnswerHumanAsk: () => ({ mutateAsync: mocks.answerAsk }),
  useResolveRunInDoubt: () => ({
    mutateAsync: mocks.resolveInDoubt,
    isPending: false,
  }),
}));

vi.mock('@tale/ui/use-toast', () => ({ toast: vi.fn() }));

const actorNames: Record<string, string> = {
  alice: 'Alice',
  future: 'Future reviewer',
  reviewer: 'Review agent',
};
vi.mock('../hooks/use-actor-directory', () => ({
  useProvidedActorDirectory: () => undefined,
  ActorDirectoryProvider: ({ children }: { children?: unknown }) => children,
  useActorDirectory: (_organizationId: string, projectId?: string) => ({
    resolveActor: (type: string, id: string) => ({
      type,
      id,
      name:
        type !== 'agent' || projectId === 'project_1'
          ? (actorNames[id] ?? id)
          : id,
      isAgent: type === 'agent',
    }),
  }),
}));

import { TaskSubjectPanel } from './task-subject-panel';

const FOLDER = 'folder_docs';

const contract: TaskSubjectContract = {
  workflow: 'document-verify-desk',
  externalSystem: 'acme',
  input: { kind: 'folder', naming: String.raw`^\d{4}Q[1-4]$` },
  start: { when: 'hasFiles && status == backlog' },
  review: { requestChanges: true },
};

function ownedBy(
  overrides: Partial<ResolvedTaskSubjectContract> = {},
): ResolvedTaskSubjectContract {
  return {
    automationSlug: 'document-verify-desk',
    displayName: 'Document verification desk',
    displayDescription:
      'Verifies one batch of incoming documents for completeness and consistency.',
    contract,
    settings: null,
    ...overrides,
  };
}

// `hasFiles` is the server-stamped subtree fact (`getTask` shares one
// predicate with the board chip and staging) — the panel consumes it, never
// re-derives it from a document listing.
function panel(
  resolved = ownedBy(),
  hasFiles = false,
  status = 'backlog',
  reviewerUserId?: string,
  taskId = 'task_1',
) {
  return (
    <TaskSubjectPanel
      organizationId="org_1"
      task={{
        _id: taskId,
        projectId: 'project_1' as string,
        status,
        externalId: FOLDER,
        hasFiles,
        reviewerUserId,
      }}
      ownedBy={resolved}
      canEdit
    />
  );
}

function renderPanel(...args: Parameters<typeof panel>) {
  return render(panel(...args));
}

function capturedReview(
  reviewer: NonNullable<TaskReviewerState['pendingReview']>['reviewer'],
  agentReviewBlockedReason: NonNullable<
    TaskReviewerState['pendingReview']
  >['agentReviewBlockedReason'] = null,
  round = 1,
): TaskReviewerState {
  return {
    reviewer: { kind: 'user', userId: 'future' },
    projectReviewer: { kind: 'agent', agentId: 'reviewer' },
    pendingReview: {
      approvalId: `approval_${round}`,
      taskId: 'task_1',
      round,
      requestedFor: reviewer?.kind === 'user' ? reviewer.userId : null,
      reviewer,
      runId: `implementation_run_${round}`,
      agentSlug: 'Implementation agent',
      implementationAgentId: 'worker',
      evidenceRevision: 'a'.repeat(64),
      agentReviewBlockedReason,
      createdAt: round,
    },
  };
}

describe('TaskSubjectPanel', () => {
  beforeEach(() => {
    mocks.run = null;
    mocks.runError = false;
    mocks.runFetching = false;
    mocks.refetchRun.mockReset();
    mocks.pendingAsk = null;
    mocks.inDoubt = null;
    mocks.resolveInDoubt.mockReset();
    mocks.resolveInDoubt.mockResolvedValue(null);
    mocks.reviewer = {
      reviewer: { kind: 'inherit' },
      projectReviewer: { kind: 'human_default' },
      pendingReview: null,
    };
    mocks.reviewerError = false;
    mocks.refetchReviewer.mockReset();
    mocks.addComment.mockReset();
    mocks.addComment.mockResolvedValue({ automationTriggered: true });
    mocks.answerAsk.mockReset();
    mocks.answerAsk.mockResolvedValue(null);
    mocks.start.mockReset();
    mocks.start.mockResolvedValue({ started: true });
    mocks.updateStatus.mockReset();
    mocks.updateStatus.mockResolvedValue(undefined);
    mocks.cancel.mockReset();
    vi.mocked(toast).mockClear();
  });

  it('retains ownership through failure and retry, then restores Start after an empty successful read', async () => {
    mocks.run = undefined;
    mocks.runError = true;
    const view = renderPanel(ownedBy(), true);
    expect(
      screen.getByRole('region', { name: 'Document verification desk' }),
    ).toBeVisible();
    expect(
      screen.getByText(
        'Verifies one batch of incoming documents for completeness and consistency.',
      ),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the workflow state.",
    );
    expect(
      screen.queryByRole('button', { name: 'Start' }),
    ).not.toBeInTheDocument();
    await view.user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refetchRun).toHaveBeenCalledTimes(1);
    expect(mocks.start).not.toHaveBeenCalled();
    expect(mocks.cancel).not.toHaveBeenCalled();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
    mocks.runError = false;
    mocks.runFetching = true;
    view.rerender(panel(ownedBy(), true));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveAttribute(
      'aria-busy',
      'true',
    );
    mocks.runError = true;
    mocks.runFetching = false;
    view.rerender(panel(ownedBy(), true));
    expect(screen.getByRole('alert')).toBeVisible();
    expect(screen.getByRole('button', { name: 'Try again' })).toBeEnabled();
    mocks.runError = false;
    mocks.run = null;
    view.rerender(panel(ownedBy(), true));
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Start' })).toBeEnabled();
  });

  it('does not derive workflow actions from stale data after a failed read', () => {
    mocks.runError = true;
    renderPanel(ownedBy(), true);
    expect(screen.getByRole('alert')).toBeVisible();
    expect(
      screen.queryByRole('button', { name: 'Start' }),
    ).not.toBeInTheDocument();
  });

  it('keeps initial loading quiet and clears failed-read memory for another task', () => {
    mocks.run = undefined;
    const view = renderPanel(ownedBy(), true);
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
    mocks.runError = true;
    view.rerender(panel(ownedBy(), true));
    expect(screen.getByRole('alert')).toBeVisible();
    mocks.runError = false;
    view.rerender(panel(ownedBy(), true, 'backlog', undefined, 'task_2'));
    expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });

  it('shows the captured agent review without human verdict actions on an automation-owned task', () => {
    mocks.reviewer = capturedReview({ kind: 'agent', agentId: 'reviewer' });
    const resolved = resolveTaskSubjectContract(
      {
        createdBy: 'creator',
        createdByType: 'user',
        assigneeType: 'app',
        assigneeId: 'document-verify-desk',
      },
      [
        {
          name: 'document-verify-desk',
          deployedVersion: 1,
          taskContract: contract,
        },
      ],
      'en',
    );
    if (resolved === null)
      throw new Error('the assigned automation must resolve');
    renderPanel(resolved, true, 'in_review', 'future');

    expect(
      screen.getByText('Current review: Review agent'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('The assigned reviewer agent must decide this review.'),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/waiting on Future reviewer/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request changes' }),
    ).not.toBeInTheDocument();
  });

  it('explains the server-derived blocker for the captured agent review', () => {
    mocks.reviewer = capturedReview(
      { kind: 'agent', agentId: 'reviewer' },
      'source_required',
    );
    renderPanel(ownedBy(), true, 'in_review', 'future');

    expect(
      screen.getByText('Current review: Review agent'),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'This result has no supported implementation run to review.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(
        'The assigned reviewer agent must decide this review.',
      ),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
  });

  it('keeps a captured human reviewer and the ordinary workflow approval usable', async () => {
    mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
    const { user } = renderPanel(ownedBy(), true, 'in_review', 'future');

    expect(screen.getByText('Current review: Alice')).toBeInTheDocument();
    expect(
      screen.queryByText(/waiting on Future reviewer/),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Request changes' }),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    await user.type(
      screen.getByRole('textbox', { name: 'What should change' }),
      'Check the last document.',
    );
    await user.click(screen.getByRole('button', { name: 'Send back' }));
    expect(mocks.addComment).toHaveBeenCalledExactlyOnceWith({
      taskId: 'task_1',
      body: '@document-verify-desk Check the last document.',
    });
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(mocks.updateStatus).toHaveBeenCalledExactlyOnceWith({
      taskId: 'task_1',
      status: 'done',
    });
  });

  it('explains a refused human approval when organization policy is unavailable', async () => {
    mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
    mocks.updateStatus.mockRejectedValueOnce(
      new AppError({
        code: 'TASK_REVIEW_POLICY_UNAVAILABLE',
        message:
          'The review policy is unavailable; restore valid configuration before deciding',
      }),
    );
    const { user } = renderPanel(ownedBy(), true, 'in_review', 'alice');
    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await waitFor(() =>
      expect(toast).toHaveBeenCalledExactlyOnceWith({
        title:
          'Review policy could not be read. Restore valid organization policy before deciding.',
        variant: 'destructive',
      }),
    );
    expect(mocks.updateStatus).toHaveBeenCalledExactlyOnceWith({
      taskId: 'task_1',
      status: 'done',
    });
    expect(mocks.addComment).not.toHaveBeenCalled();
    expect(screen.getByText('Current review: Alice')).toBeInTheDocument();
  });

  it('does not offer a human verdict or name a future reviewer before the captured review loads', () => {
    mocks.reviewer = undefined;
    renderPanel(ownedBy(), true, 'in_review', 'future');

    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.queryByText(/waiting on Future reviewer/),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Request changes' }),
    ).not.toBeInTheDocument();
  });

  it('offers a retry instead of a verdict when the captured review refresh fails', async () => {
    mocks.reviewerError = true;
    const { user } = renderPanel(ownedBy(), true, 'in_review', 'future');

    expect(screen.getByRole('status')).toHaveTextContent(
      "Couldn't load the current review. Try again before changing it.",
    );
    expect(
      screen.queryByRole('button', { name: 'Approve' }),
    ).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(mocks.refetchReviewer).toHaveBeenCalledOnce();
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it.each(['Approve', 'Request changes'])(
    'closes an open %s confirmation when the captured reviewer becomes an agent',
    async (action) => {
      mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
      const resolved = ownedBy({
        approveConfirmation: 'Approve these documents for processing.',
      });
      const { user, rerender } = renderPanel(
        resolved,
        true,
        'in_review',
        'future',
      );
      await user.click(screen.getByRole('button', { name: action }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();

      mocks.reviewer = capturedReview({ kind: 'agent', agentId: 'reviewer' });
      rerender(panel(resolved, true, 'in_review', 'future'));

      await waitFor(() =>
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument(),
      );
      expect(
        screen.queryByRole('button', { name: 'Approve' }),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByRole('button', { name: 'Send back' }),
      ).not.toBeInTheDocument();
      expect(mocks.updateStatus).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();

      mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
      rerender(panel(resolved, true, 'in_review', 'future'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      await waitFor(() =>
        expect(
          screen.getByRole('button', { name: action }),
        ).toBeInTheDocument(),
      );
      expect(mocks.updateStatus).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();

      await user.click(screen.getByRole('button', { name: action }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(mocks.updateStatus).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();
    },
  );

  for (const transition of [
    'done',
    'todo',
    'loading',
    'replacement',
  ] as const) {
    it.each(['Approve', 'Request changes'])(
      `requires a fresh %s gesture after ${transition} replaces the review`,
      async (action) => {
        mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
        const resolved = ownedBy({
          approveConfirmation: 'Approve these documents for processing.',
        });
        const { user, rerender } = renderPanel(
          resolved,
          true,
          'in_review',
          'alice',
        );
        await user.click(screen.getByRole('button', { name: action }));
        if (action === 'Request changes') {
          await user.type(
            screen.getByRole('textbox', { name: 'What should change' }),
            'Keep this feedback draft',
          );
        }
        expect(screen.getByRole('dialog')).toBeInTheDocument();

        if (transition !== 'replacement') {
          if (transition === 'loading') mocks.run = undefined;
          rerender(
            panel(
              resolved,
              true,
              transition === 'loading' ? 'in_review' : transition,
              'alice',
            ),
          );
          expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
          mocks.run = null;
        }
        mocks.reviewer = capturedReview(
          { kind: 'user', userId: 'alice' },
          null,
          2,
        );
        rerender(panel(resolved, true, 'in_review', 'alice'));
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(mocks.updateStatus).not.toHaveBeenCalled();
        expect(mocks.addComment).not.toHaveBeenCalled();

        await user.click(screen.getByRole('button', { name: action }));
        expect(screen.getByRole('dialog')).toBeInTheDocument();
        if (action === 'Request changes') {
          expect(
            screen.getByRole('textbox', { name: 'What should change' }),
          ).toHaveValue('Keep this feedback draft');
        }
        expect(mocks.updateStatus).not.toHaveBeenCalled();
        expect(mocks.addComment).not.toHaveBeenCalled();
      },
    );
  }

  it.each(['Approve', 'Request changes'])(
    'closes an open %s confirmation when another task uses the same workflow',
    async (action) => {
      const resolved = ownedBy({
        approveConfirmation: 'Approve these documents for processing.',
      });
      const { user, rerender } = renderPanel(
        resolved,
        true,
        'in_review',
        'alice',
      );
      await user.click(screen.getByRole('button', { name: action }));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      rerender(panel(resolved, true, 'in_review', 'alice', 'task_2'));
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(mocks.updateStatus).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();
    },
  );

  it.each(['Approve', 'Request changes'])(
    'keeps an open %s confirmation when the same review refreshes',
    async (action) => {
      mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
      const resolved = ownedBy({
        approveConfirmation: 'Approve these documents for processing.',
      });
      const { user, rerender } = renderPanel(
        resolved,
        true,
        'in_review',
        'alice',
      );
      await user.click(screen.getByRole('button', { name: action }));
      mocks.reviewer = capturedReview({ kind: 'user', userId: 'alice' });
      rerender(panel(resolved, true, 'in_review', 'alice'));
      expect(screen.getByRole('dialog')).toBeInTheDocument();
      expect(mocks.updateStatus).not.toHaveBeenCalled();
      expect(mocks.addComment).not.toHaveBeenCalled();
    },
  );

  it('keeps the running workflow question answerable when a captured agent review exists', async () => {
    mocks.reviewer = capturedReview({ kind: 'agent', agentId: 'reviewer' });
    mocks.run = {
      runId: 'run_1',
      name: 'document-verify-desk',
      status: 'waiting',
      version: 1,
      detail: null,
    };
    mocks.pendingAsk = {
      askId: 'ask_1',
      question: 'Which batch should I inspect?',
    };
    const { user } = renderPanel(ownedBy(), true, 'in_review');

    expect(
      screen.getByText(
        'Document verification desk paused with a question — it continues as soon as you answer below.',
      ),
    ).toBeInTheDocument();
    await user.type(
      screen.getByRole('textbox', { name: 'Your answer' }),
      'Inspect batch A.',
    );
    await user.click(
      screen.getByRole('button', { name: 'Send answer & resume' }),
    );
    expect(mocks.addComment).toHaveBeenCalledExactlyOnceWith({
      taskId: 'task_1',
      body: 'Inspect batch A.',
    });
    expect(mocks.answerAsk).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org_1',
      askId: 'ask_1',
      answer: 'Inspect batch A.',
    });
    expect(mocks.updateStatus).not.toHaveBeenCalled();
  });

  it('says a run waiting on a step that may already have run waits for a decision, and offers it here [AUTO-R19]', async () => {
    // Mia works the task; its run was sending the verification report when
    // the server stopped, and nobody can tell whether it arrived.
    mocks.run = {
      runId: 'run_1',
      name: 'document-verify-desk',
      status: 'waiting',
      version: 1,
      detail: 'in_doubt:send_report',
    };
    mocks.inDoubt = {
      attemptId: 'attempt_1',
      nodeId: 'send_report',
      itemIndex: 0,
      pass: 0,
      attempt: 1,
      nodeType: 'imap-smtp.send',
      connector: 'Email',
      action: 'send',
      input: { to: 'audit@example.test' },
      startedAt: 1_790_000_000_000,
    };
    const { container, user } = renderPanel(ownedBy(), true, 'in_progress');

    expect(
      screen.getByText(
        'Document verification desk waits for a decision on a step that may already have run — choose below how it continues.',
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByText('Document verification desk is working on this task.'),
    ).toBeNull();
    // Nothing is working on the run: nothing spins.
    expect(container.querySelector('.animate-spin')).toBeNull();
    expect(
      screen.getByRole('heading', {
        name: 'This step may already have run: send_report',
      }),
    ).toBeVisible();

    await user.click(screen.getByRole('button', { name: 'Skip it' }));
    expect(mocks.resolveInDoubt).toHaveBeenCalledExactlyOnceWith({
      organizationId: 'org_1',
      runId: 'run_1',
      attemptId: 'attempt_1',
      attempt: 1,
      resolution: 'skip',
    });
  });

  it('names the automation and shows the automation s own description', () => {
    renderPanel(ownedBy(), true);

    expect(
      screen.getByRole('heading', { name: 'Document verification desk' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        'Verifies one batch of incoming documents for completeness and consistency.',
      ),
    ).toBeInTheDocument();
  });

  it('shows no description line when the pack declared none', () => {
    const { container } = renderPanel(
      ownedBy({ displayDescription: undefined }),
      true,
    );

    expect(
      screen.getByRole('heading', { name: 'Document verification desk' }),
    ).toBeInTheDocument();
    expect(container.querySelector('.line-clamp-2')).toBeNull();
  });

  // The regression this file exists for: the waiting-for-input copy tells the
  // reader to upload "then press Start", so Start must be ON SCREEN — inert,
  // explained, and impossible to fire — rather than absent until files land.
  it('keeps Start on screen while input is missing, inert and explained', async () => {
    const { user } = renderPanel();

    expect(
      screen.getByText(
        'Waiting for input files — upload them below, then press Start.',
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).toHaveAttribute('aria-disabled', 'true');
    // Soft-disabled, so it stays reachable — a natively disabled button could
    // never surface its reason to a keyboard user.
    expect(start).not.toHaveAttribute('disabled');

    await user.click(start);
    expect(mocks.start).not.toHaveBeenCalled();
  });

  it('starts the workflow once the stamped fact says the folder has files', async () => {
    const { user } = renderPanel(ownedBy(), true);

    expect(
      screen.getByText(
        'Ready to start — Document verification desk takes it from here.',
      ),
    ).toBeInTheDocument();
    const start = screen.getByRole('button', { name: 'Start' });
    expect(start).not.toHaveAttribute('aria-disabled');

    await user.click(start);
    expect(mocks.start).toHaveBeenCalledWith({
      organizationId: 'org_1',
      taskId: 'task_1',
      workflowSlug: 'document-verify-desk',
    });
  });

  it('stays inert when the stamp is absent (fact not loaded is not "ready")', () => {
    render(
      <TaskSubjectPanel
        organizationId="org_1"
        task={{
          _id: 'task_1' as string,
          projectId: 'project_1' as string,
          status: 'backlog',
          externalId: FOLDER,
        }}
        ownedBy={ownedBy()}
        canEdit
      />,
    );

    expect(screen.getByRole('button', { name: 'Start' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  // Approve writes Done in one gesture. An automation whose Done means more
  // outside the task declares that consequence, and only then does Approve
  // ask first — so a reviewer cannot give that attestation by a slip, while
  // every other automation keeps its one-click close.
  it('approves in one click when the automation declares no consequence', async () => {
    const { user } = renderPanel(ownedBy(), true, 'in_review');

    await user.click(screen.getByRole('button', { name: 'Approve' }));

    expect(mocks.updateStatus).toHaveBeenCalledWith({
      taskId: 'task_1',
      status: 'done',
    });
    expect(
      screen.queryByText('Approve the output of Document verification desk?'),
    ).not.toBeInTheDocument();
  });

  it('asks before approving when the automation declares what approving decides', async () => {
    const consequence =
      'Approving tells the client this return has been filed with the tax authority.';
    // Resolved from the deployed listing entry exactly as the task modal
    // resolves it: a hand-built contract here once hid that the modal's
    // narrowing dropped the confirmation, so Approve never asked.
    const resolved = resolveTaskSubjectContract(
      { createdBy: 'user_1', createdByType: 'user', externalSystem: 'acme' },
      [
        {
          name: 'document-verify-desk',
          deployedVersion: 1,
          taskContract: {
            ...contract,
            review: { requestChanges: true, approve: { confirm: consequence } },
          },
          presentation: { name: 'Document verification desk' },
        },
      ],
      'en',
    );
    if (resolved === null) {
      throw new Error('the declared desk does not own the task');
    }
    const { user } = renderPanel(resolved, true, 'in_review');

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    expect(
      await screen.findByText(
        'Approve the output of Document verification desk?',
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(consequence)).toBeInTheDocument();
    expect(mocks.updateStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(mocks.updateStatus).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Approve' }));
    await screen.findByText(consequence);
    const confirm = screen.getAllByRole('button', { name: 'Approve' }).at(-1);
    if (confirm === undefined)
      throw new Error('the confirmation has no Approve');
    await user.click(confirm);

    expect(mocks.updateStatus).toHaveBeenCalledTimes(1);
    expect(mocks.updateStatus).toHaveBeenCalledWith({
      taskId: 'task_1',
      status: 'done',
    });
  });

  // The board dialog keeps the panel mounted when it opens another task (a
  // subtask, the parent, a link in a comment). Whatever the reader was
  // saying about one task stays with that task: a Request changes draft for
  // task A must not be waiting, pre-filled, in task B's dialog.
  it('keeps a Request changes draft with the task it was written for', async () => {
    const taskOf = (id: string) => ({
      _id: id,
      projectId: 'project_1',
      status: 'in_review',
      externalId: FOLDER,
      hasFiles: true,
    });
    const { user, rerender } = render(
      <TaskSubjectPanel
        organizationId="org_1"
        task={taskOf('task_a')}
        ownedBy={ownedBy()}
        canEdit
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Request changes' }));
    await user.type(
      await screen.findByRole('textbox', { name: 'What should change' }),
      'Task A: replace the old figures',
    );
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    rerender(
      <TaskSubjectPanel
        organizationId="org_1"
        task={taskOf('task_b')}
        ownedBy={ownedBy()}
        canEdit
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Request changes' }));

    expect(
      await screen.findByRole('textbox', { name: 'What should change' }),
    ).toHaveValue('');
  });

  // Cancel run parks the task at Cancelled, which closes it: a parent whose
  // subtasks are still open is refused, and the run keeps running. The
  // reader hears that reason once, not "something went wrong".
  it('names the open subtasks when Cancel run is refused for them', async () => {
    mocks.run = {
      runId: 'run_1',
      name: 'document-verify-desk',
      status: 'waiting',
      version: 1,
      detail: null,
    };
    mocks.cancel.mockRejectedValue(
      new AppError({
        code: 'TASK_HAS_OPEN_SUBTASKS',
        message: 'Open subtasks remain',
      }),
    );
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { user } = renderPanel(ownedBy(), true, 'in_progress');

    await user.click(screen.getByRole('button', { name: 'Cancel run' }));
    await screen.findByText('Cancel this run?');
    const confirm = screen
      .getAllByRole('button', { name: 'Cancel run' })
      .at(-1);
    if (confirm === undefined) throw new Error('the dialog has no Cancel run');
    await user.click(confirm);

    expect(mocks.cancel).toHaveBeenCalledWith({
      organizationId: 'org_1',
      taskId: 'task_1',
    });
    expect(toast).toHaveBeenCalledExactlyOnceWith({
      title: 'Finish all subtasks before closing this task.',
      description: undefined,
      variant: 'destructive',
    });
  });
});
