'use client';

import type { PendingReviewIdentity } from '@tale/shared/schemas/task-review';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { ConfirmDialog } from '@tale/ui/dialog/confirm-dialog';
import { Row } from '@tale/ui/layout';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { Text } from '@tale/ui/text';
import { Textarea } from '@tale/ui/textarea';
import { toast } from '@tale/ui/use-toast';
import { CheckCircle2, Loader2, Play, Undo2, Workflow } from 'lucide-react';
import { useId, useState } from 'react';

import {
  RunApprovalCard,
  approvalIdFromDetail,
} from '@/app/features/automations/components/run-approval-card';
import { RunAskCard } from '@/app/features/automations/components/run-ask-card';
import {
  RunInDoubtCard,
  inDoubtNodeFromDetail,
} from '@/app/features/automations/components/run-in-doubt-card';
import { RunQuarantineCard } from '@/app/features/automations/components/run-quarantine-card';
import { useRunPendingAsk } from '@/app/features/automations/hooks/queries';
import { useBackendAction } from '@/app/hooks/use-backend-action';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useAddTaskComment, useUpdateTaskStatus } from '../hooks/mutations';
import { useActorDirectory } from '../hooks/use-actor-directory';
import type { ResolvedTaskSubjectContract } from '../hooks/use-task-subject-contract';
import { parentCloseRefusal } from '../lib/parent-close-refusal';
import { reviewPolicyErrorMessage } from '../lib/review-policy-error';
import { reviewerBlockedMessage } from '../lib/reviewer-refusal';
import { deriveSubjectState } from '../lib/subject-state';
import { TaskRunDetailsDialog } from './task-run-details-dialog';

function reviewConfirmationIdentity(
  taskId: string,
  review: PendingReviewIdentity | null,
): string {
  const recipient = review?.reviewer;
  return JSON.stringify([
    taskId,
    review?.approvalId ?? null,
    review?.runId ?? null,
    recipient?.kind ?? null,
    recipient?.kind === 'agent'
      ? recipient.agentId
      : (recipient?.userId ?? null),
  ]);
}

/**
 * The automation-ownership work panel of the task modal — the read-side twin
 * of the status choreography, with EXPLICIT verbs so nothing depends on
 * knowing the drag semantics: what the task is waiting for, a Start button
 * when the contract's gate holds, Cancel while the run is in flight (with
 * its progress and inline approvals, as before), and Approve / Request
 * changes when the output sits in review. Approve asks first only when the
 * automation declared what approving decides beyond the task. Every state
 * and verb derives from the generic subject contract — nothing here knows
 * any specific automation.
 *
 * It reads top-to-bottom as the whole answer to opening the task: WHO owns it
 * (the automation's declared name), WHAT it is (the automation's own
 * description — live from the deployed version, never copied into the task),
 * WHAT NOW (the state line) and WHAT TO PRESS (the verb). The primary verb is
 * therefore never absent while the task is startable-in-principle: waiting for
 * input renders Start soft-disabled with the reason attached, because a promise
 * of "then start" with no Start on screen leaves the reader hunting the board
 * for a gesture that doesn't exist.
 *
 * Everything the reader started here belongs to ONE task: the board dialog
 * keeps this panel mounted when it opens another task, so each task gets a
 * fresh panel — a Request changes draft, a pending verb or an open
 * confirmation never carries over to the next task.
 */
export function TaskSubjectPanel(props: TaskSubjectPanelProps) {
  return <TaskSubjectPanelBody key={props.task._id} {...props} />;
}

interface TaskSubjectPanelProps {
  organizationId: string;
  task: {
    _id: string;
    projectId: string;
    status: string;
    externalId?: string;
    reviewerUserId?: string;
    /** Stamped by `getTask`/the list queries: ≥1 active stored file anywhere
     * in the bound folder's SUBTREE — the one server-side predicate every
     * Start gate shares. */
    hasFiles?: boolean;
  };
  ownedBy: ResolvedTaskSubjectContract;
  /** The viewer may work the task (`useTaskAccess`): start, approve,
   * request changes, cancel. */
  canEdit: boolean;
}

function TaskSubjectPanelBody({
  organizationId,
  task,
  ownedBy,
  canEdit,
}: TaskSubjectPanelProps) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  const headingId = useId();
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [changesOpen, setChangesOpen] = useState(false);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState(false);

  const {
    automationSlug,
    displayName,
    displayDescription,
    approveConfirmation,
    contract,
  } = ownedBy;
  // Share the reviewer field's cached read: a captured review can belong to
  // an agent even when a deployed automation currently owns the task.
  const reviewerQuery = useBackendQuery(
    'tasks/queries:getTaskReviewer',
    task.status === 'in_review' ? { organizationId, taskId: task._id } : 'skip',
  );
  const reviewReady =
    reviewerQuery.data !== undefined && !reviewerQuery.isError;
  const pendingReview = reviewerQuery.data?.pendingReview;
  const recipient = pendingReview?.reviewer;
  const agentReview = recipient?.kind === 'agent';
  const { resolveActor } = useActorDirectory(organizationId, task.projectId);
  const reviewerName =
    recipient !== undefined && recipient !== null
      ? resolveActor(
          recipient.kind,
          recipient.kind === 'user' ? recipient.userId : recipient.agentId,
        ).name
      : reviewReady &&
          pendingReview === null &&
          task.reviewerUserId !== undefined
        ? resolveActor('user', task.reviewerUserId).name
        : undefined;

  const runQuery = useBackendQuery('automations/queries:getLiveRunForTask', {
    organizationId,
    projectId: task.projectId,
    taskId: task._id,
  });
  // A retry without cached data can return to pending. Keep the explanation
  // mounted until a successful read, rather than losing the recovery surface.
  const [runReadFailed, setRunReadFailed] = useState(false);
  const runReadError = runQuery.isError || runReadFailed;
  if (runQuery.isError && !runReadFailed) setRunReadFailed(true);
  if (!runQuery.isError && runQuery.data !== undefined && runReadFailed) {
    setRunReadFailed(false);
  }
  const run = runQuery.data ?? null;
  // The live run's parked question, if its agent asked one — the panel's
  // whole story flips to "answer this" while it is pending.
  const pendingAskQuery = useRunPendingAsk(organizationId, run?.runId);
  const pendingAsk = pendingAskQuery.data ?? null;
  // A write the run was making when its server stopped may already have
  // reached its service: the run waits for a person to decide how it goes
  // on, and nothing works on it meanwhile.
  const inDoubtNode =
    run?.status === 'waiting' ? inDoubtNodeFromDetail(run.detail) : undefined;

  // `hasFiles` is the server-stamped subtree fact (`getTask` and the list
  // queries share one predicate with staging) — a client-side root-only probe
  // here once disagreed with the board chip on nested-only deliveries.
  const folderBound =
    contract.input?.kind === 'folder' &&
    typeof task.externalId === 'string' &&
    task.externalId !== '';
  const hasFiles = folderBound && task.hasFiles === true;

  const startRun = useBackendAction('tasks/public_actions:startTaskWorkflow', {
    errorToast: false,
  });
  const cancelRun = useBackendAction(
    'tasks/public_actions:cancelTaskWorkflow',
    {
      errorToast: false,
    },
  );
  const updateStatus = useUpdateTaskStatus();
  const addComment = useAddTaskComment();

  const state =
    runQuery.data === undefined
      ? null
      : deriveSubjectState(contract, {
          status: task.status,
          runActive: run !== null,
          hasFiles,
        });
  const canReview =
    canEdit &&
    !runReadError &&
    state?.kind === 'review' &&
    reviewReady &&
    !agentReview;
  const reviewIdentity = reviewConfirmationIdentity(
    task._id,
    pendingReview ?? null,
  );
  const [lastReviewIdentity, setLastReviewIdentity] = useState(reviewIdentity);
  const reviewChanged = lastReviewIdentity !== reviewIdentity;
  if (reviewChanged) setLastReviewIdentity(reviewIdentity);
  // Losing the gate or replacing its captured review closes the confirmation
  // itself. The draft stays, but a new review needs a fresh user gesture.
  if ((!canReview || reviewChanged) && (approveOpen || changesOpen)) {
    setApproveOpen(false);
    setChangesOpen(false);
  }
  const ownershipContext = (
    <>
      <Row gap={2} align="center">
        <Workflow
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text
          as="h3"
          id={headingId}
          variant="label"
          className="min-w-0 flex-1 truncate"
        >
          {displayName}
        </Text>
        {!runReadError && state?.kind === 'running' && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetailsOpen(true)}
          >
            {t('run.details')}
          </Button>
        )}
      </Row>

      {/* The automation's OWN words on what it does — clamped, because a pack
          may declare a paragraph and this is orientation, not documentation. */}
      {displayDescription !== undefined && (
        <Text as="p" variant="caption" className="line-clamp-2 text-pretty">
          {displayDescription}
        </Text>
      )}
    </>
  );
  if (runReadError) {
    return (
      <section
        aria-labelledby={headingId}
        className="border-border bg-card flex flex-col gap-2 rounded-lg border p-3"
      >
        {ownershipContext}
        <Text as="p" role="alert" className="text-pretty">
          {t('subject.runLoadError')}
        </Text>
        <Row gap={2} wrap>
          <Button
            variant="secondary"
            size="sm"
            aria-busy={runQuery.isFetching}
            disabled={runQuery.isFetching}
            onClick={() => void runQuery.refetch()}
          >
            {tCommon('actions.tryAgain')}
          </Button>
        </Row>
      </section>
    );
  }
  // Facts still loading — render nothing rather than a state that flips.
  if (state === null || state.kind === 'idle') return null;
  // A folder-input contract on a task with NO bound folder has no upload
  // surface to point at — "waiting for input" would be a dead end. The
  // ownership badge still marks the task; the panel stays quiet.
  if (
    state.kind === 'waiting_input' &&
    contract.input?.kind === 'folder' &&
    !folderBound
  ) {
    return null;
  }
  const start = async (successTitle: string) => {
    setBusy(true);
    try {
      const result = await startRun.mutateAsync({
        organizationId,
        taskId: task._id,
        workflowSlug: automationSlug,
      });
      if (result.started) {
        toast({ title: successTitle, variant: 'success' });
      } else {
        toast({
          title:
            result.reason === 'already_running'
              ? t('run.alreadyRunning', { name: displayName })
              : t('run.notStarted', { name: displayName }),
          variant:
            result.reason === 'already_running' ? undefined : 'destructive',
        });
      }
    } catch (error) {
      console.error('[tasks] subject-panel start failed', error);
      toast({
        title: t('run.notStarted', { name: displayName }),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      await cancelRun.mutateAsync({ organizationId, taskId: task._id });
      toast({ title: t('run.cancelled') });
    } catch (error) {
      console.error('[tasks] subject-panel cancel failed', error);
      // Cancel parks the task at Cancelled, which closes it: open subtasks
      // refuse that, and the run keeps running. Say so, not "went wrong".
      const refusal = parentCloseRefusal(error, t);
      toast({
        title: refusal ?? tCommon('errors.generic'),
        description: refusal === undefined ? failureDetail(error) : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
      setCancelOpen(false);
    }
  };

  const approve = async () => {
    if (!canReview) return;
    setBusy(true);
    try {
      await updateStatus.mutateAsync({ taskId: task._id, status: 'done' });
      toast({ title: t('subject.approved'), variant: 'success' });
    } catch (error) {
      // Same guard surface as the status picker: a parent with open subtasks
      // cannot close — and Approve writes Done, which decides any pending
      // review, so the org's review_policy can refuse it too. The user should
      // hear the reason, not a generic error.
      const reviewRefusal = reviewPolicyErrorMessage(error, t);
      const closeRefusal = parentCloseRefusal(error, t);
      if (closeRefusal !== undefined) {
        toast({ title: closeRefusal, variant: 'destructive' });
      } else if (reviewRefusal !== undefined) {
        toast({ title: reviewRefusal, variant: 'destructive' });
      } else {
        console.error('[tasks] subject-panel approve failed', error);
        toast({
          title: tCommon('errors.generic'),
          description: failureDetail(error),
          variant: 'destructive',
        });
      }
    } finally {
      setBusy(false);
      setApproveOpen(false);
    }
  };

  /**
   * Request changes is ONE gesture, and that gesture is an `@`-mention: the
   * feedback posts as a task comment addressed to the owning automation
   * (`@<slug> …`), and the comment's mention trigger starts the rerun — the
   * same lane a hand-typed `@` in the composer uses, so the timeline itself
   * teaches the pattern. Plain comments stay inert; only the mention runs.
   * The rerun starts after the comment lands (same transaction), so the
   * workflow's next pass always reads this feedback.
   */
  const requestChanges = async () => {
    if (!canReview) return;
    const body = feedback.trim();
    if (body === '') return;
    setBusy(true);
    try {
      const result = await addComment.mutateAsync({
        taskId: task._id,
        body: `@${automationSlug} ${body}`,
      });
      // The comment landed either way, so the box always closes and empties:
      // leaving the text in a still-open dialog invites a second Send back,
      // which would file the same feedback twice.
      setChangesOpen(false);
      setFeedback('');
      if (result.automationTriggered) {
        toast({
          title: t('subject.requestChangesSent', { name: displayName }),
          variant: 'success',
        });
      } else {
        // Say what did NOT happen — the feedback is recorded, nothing new is
        // running. The one quiet-refusal cause this gesture can actually hit
        // is a run already operating the task (the panel hides Request
        // changes otherwise), so phrase it as that.
        toast({ title: t('run.alreadyRunning', { name: displayName }) });
      }
    } catch (error) {
      // `useAddTaskComment`'s own toast reports the failure.
      console.error('[tasks] request-changes failed', error);
    } finally {
      setBusy(false);
    }
  };

  if (run?.status === 'quarantined') {
    return (
      <section aria-labelledby={headingId} className="flex flex-col gap-3">
        {ownershipContext}
        <RunQuarantineCard
          key={run.runId}
          organizationId={organizationId}
          runId={run.runId}
          quarantine={run.legacyQuarantine}
          canRequestStop={canEdit}
          onReload={() => void runQuery.refetch()}
        />
        <TaskRunDetailsDialog
          organizationId={organizationId}
          projectId={task.projectId}
          automationSlug={run.name}
          runId={run.runId}
          name={displayName}
          live={false}
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      </section>
    );
  }

  const stateLine =
    state.kind === 'running'
      ? pendingAsk !== null
        ? t('run.waitingAnswer', { name: displayName })
        : inDoubtNode !== undefined
          ? canEdit
            ? t('run.waitingDecision', { name: displayName })
            : t('run.waitingDecisionOther', { name: displayName })
          : t('run.working', { name: displayName })
      : state.kind === 'review'
        ? pendingReview !== undefined && pendingReview !== null
          ? t('reviewer.pendingFor', {
              reviewer: reviewerName ?? t('reviewer.none'),
            })
          : reviewerName !== undefined
            ? t('subject.reviewWaitingOn', {
                name: displayName,
                reviewer: reviewerName,
              })
            : t('subject.review', { name: displayName })
        : state.kind === 'ready'
          ? t('subject.ready', { name: displayName })
          : state.kind === 'waiting_input'
            ? t('subject.waitingInput')
            : t('subject.stalled');

  const approvalId =
    run !== null ? approvalIdFromDetail(run.detail) : undefined;

  return (
    <section
      aria-labelledby={headingId}
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-3',
        // This panel is what the reader opened the task FOR, so it carries the
        // accent whenever the next move is theirs. A run in flight is a plain
        // card: there is nothing to press, and the spinner tells that story.
        state.kind === 'running'
          ? 'border-border bg-card'
          : 'border-primary/40 bg-primary/[0.03]',
      )}
    >
      {ownershipContext}

      <Skeletonize
        loading={
          state.kind === 'review' && !reviewReady && !reviewerQuery.isError
        }
      >
        <Row gap={2} align="center">
          {state.kind === 'running' &&
            pendingAsk === null &&
            inDoubtNode === undefined && (
              <Loader2
                className="text-muted-foreground size-4 shrink-0 animate-spin"
                aria-hidden
              />
            )}
          <Text as="p" className="min-w-0 flex-1 text-pretty">
            {stateLine}
          </Text>
        </Row>
      </Skeletonize>

      {state.kind === 'review' && reviewerQuery.isError && (
        <Row gap={2} align="center">
          <Text as="p" variant="caption" role="status">
            {t('reviewer.loadError')}
          </Text>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => void reviewerQuery.refetch()}
          >
            {tCommon('actions.tryAgain')}
          </Button>
        </Row>
      )}
      {state.kind === 'review' && reviewReady && agentReview && (
        <Text as="p" variant="caption">
          {reviewerBlockedMessage(
            pendingReview?.agentReviewBlockedReason ?? null,
            t,
          ) ?? t('reviewer.agentRequired')}
        </Text>
      )}

      {pendingAsk !== null && (
        <RunAskCard
          organizationId={organizationId}
          ask={pendingAsk}
          // The member's answer lands on the task timeline as THEIR comment
          // before the resume kicks, so the thread shows who decided what.
          onAnswerPosted={async (answer) => {
            await addComment.mutateAsync({ taskId: task._id, body: answer });
          }}
        />
      )}

      {canEdit && (state.kind !== 'review' || canReview) && (
        <Row gap={2} wrap className="mt-1">
          {(state.kind === 'ready' ||
            state.kind === 'stalled' ||
            state.kind === 'waiting_input') && (
            <Button
              size="sm"
              // Soft-disabled, not absent: the verb stays where the reader was
              // told to look, and the tooltip (pointer AND keyboard, via the
              // shared primitive) says what is missing.
              disabled={busy || state.kind === 'waiting_input'}
              disabledReason={
                state.kind === 'waiting_input'
                  ? t('run.missingInput')
                  : undefined
              }
              icon={Play}
              onClick={() =>
                void start(t('run.started', { name: displayName }))
              }
            >
              {state.kind === 'stalled'
                ? t('subject.startAgain')
                : t('subject.start')}
            </Button>
          )}
          {state.kind === 'running' && (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => setCancelOpen(true)}
            >
              {t('subject.cancel')}
            </Button>
          )}
          {state.kind === 'review' && (
            <>
              <Button
                size="sm"
                disabled={busy}
                icon={CheckCircle2}
                onClick={() =>
                  approveConfirmation === undefined
                    ? void approve()
                    : setApproveOpen(true)
                }
              >
                {t('subject.approve')}
              </Button>
              {state.requestChanges && (
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy}
                  icon={Undo2}
                  onClick={() => setChangesOpen(true)}
                >
                  {t('subject.requestChanges')}
                </Button>
              )}
            </>
          )}
        </Row>
      )}

      {approvalId !== undefined && (
        <RunApprovalCard
          organizationId={organizationId}
          approvalId={approvalId}
        />
      )}
      {/* Deciding moves the run on, like stopping it: only someone who may
          work the task decides; anyone else reads the state line. */}
      {canEdit && run !== null && inDoubtNode !== undefined && (
        <RunInDoubtCard
          key={run.runId}
          organizationId={organizationId}
          runId={run.runId}
          node={inDoubtNode}
        />
      )}
      {run !== null && (
        <TaskRunDetailsDialog
          organizationId={organizationId}
          projectId={task.projectId}
          automationSlug={run.name}
          runId={run.runId}
          name={displayName}
          // `getLiveRunForTask` only ever returns a non-terminal run.
          live
          open={detailsOpen}
          onOpenChange={setDetailsOpen}
        />
      )}
      <ConfirmDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        title={t('subject.cancelConfirmTitle')}
        description={t('subject.cancelConfirmBody', { name: displayName })}
        confirmText={t('subject.cancel')}
        isLoading={busy}
        variant="destructive"
        onConfirm={() => void cancel()}
      />
      <ConfirmDialog
        open={approveOpen && canReview}
        onOpenChange={(next) => {
          if (!next && !busy) setApproveOpen(false);
        }}
        title={t('subject.approveConfirmTitle', { name: displayName })}
        description={approveConfirmation}
        confirmText={t('subject.approve')}
        isLoading={busy}
        onConfirm={() => void approve()}
      />
      <ConfirmDialog
        open={changesOpen && canReview}
        onOpenChange={(next) => {
          if (!next && !busy) setChangesOpen(false);
        }}
        title={t('subject.requestChanges')}
        description={t('subject.requestChangesDialog', { name: displayName })}
        confirmText={t('subject.requestChangesSend')}
        isLoading={busy}
        disableConfirm={feedback.trim() === ''}
        onConfirm={() => void requestChanges()}
      >
        <Textarea
          aria-label={t('subject.requestChangesLabel')}
          placeholder={t('subject.requestChangesPlaceholder')}
          rows={5}
          value={feedback}
          onChange={(event) => setFeedback(event.target.value)}
        />
      </ConfirmDialog>
    </section>
  );
}
