'use client';

/**
 * The agent lane's compact work strip, subordinate to the Assignee field in
 * the task modal's property panel — the run is the ASSIGNEE's state, not a
 * second subject, so it reads as one status line plus small verbs instead of
 * a card competing with the task body. Shows the task's LATEST agent run —
 * live with Cancel, failed with Retry (a failed run keeps the task at In
 * progress — failure is the run's state, not the task's; what the failure
 * means for the reader is said once, in the task's body, by
 * `TaskAgentRunFailureNotice`), settled as "reported for review" (the report
 * itself is the agent's comment in the timeline) — and, before any run
 * exists, an explicit Start so kicking the agent never requires knowing the
 * drag verb. Every run offers Details: the agent's sandbox transcript, live
 * while it works and preserved after it settles, and for a failed run what
 * the run itself reported.
 */

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { useRetryFocus } from '@tale/ui/use-retry-focus';
import { Loader2, Play, RotateCcw, XCircle } from 'lucide-react';
import { useState } from 'react';

import { ExecutionLogView } from '@/app/features/automations/components/agent-execution-log';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';
import { taskRunFailureClass } from '@/lib/shared/task-run-failure';

import { useTaskAgentRunControls } from '../hooks/use-task-agent-run-controls';
import {
  isAgentRunWaiting,
  TaskAgentRunWaitingNote,
  waitingCopyKey,
} from './task-agent-run-waiting';

interface TaskAgentRunEntryProps {
  organizationId: string;
  taskId: string;
  assigneeId: string;
  /** The viewer may work the task (`useTaskAccess`): start, retry and
   * cancel its agent. Reading the run is for everyone. */
  canEdit: boolean;
  /** Whether the viewer may stop the live run this person started — the
   * work gate's, and the starter's own even once the task is no longer
   * theirs. Absent: stopping follows `canEdit`. */
  canStopRun?: (startedBy: string | undefined) => boolean;
  /**
   * Whether the task's assignee is an agent that still exists in the project
   * (default `true`). A deleted agent's runs stay readable — Details is a
   * read — but Start and Retry would only kick a run that cannot exist, so
   * both are withheld until the task is reassigned.
   */
  assigneeLive?: boolean;
}

/**
 * The run's sandbox transcript, inspected WITHOUT leaving the task — the
 * agent twin of the subject panel's `TaskRunDetailsDialog`. Nothing is
 * fetched until it opens. A failed run leads with what it means and what it
 * reported; a run whose turn never wrote an op (it could not start) shows
 * that alone, and any other run without one degrades to the empty line.
 */
function TaskAgentRunDetailsDialog({
  organizationId,
  runId,
  name,
  live,
  failure,
  open,
  onOpenChange,
}: {
  organizationId: string;
  runId: string;
  name: string;
  /** The RUN row's liveness, not the op's — a queued run has no op yet, and
   * an op can settle a beat before its run row does. It picks the title's
   * tense ("progress" only while there is progress to watch) and the
   * header's spinner. */
  live: boolean;
  /** Set for a failed run: its classification and the raw reason it kept. */
  failure?: { failureCode?: string; error?: string };
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const opQuery = useBackendQuery(
    'tasks/queries:getTaskAgentRunSandboxOp',
    open ? { organizationId, runId } : 'skip',
  );
  const op = opQuery.data ?? null;
  const readStatus =
    !open || op !== null
      ? 'ready'
      : opQuery.isFetching
        ? 'loading'
        : opQuery.isError
          ? 'failed'
          : opQuery.data === null
            ? 'ready'
            : 'loading';
  const retryFocus = useRetryFocus(readStatus, `${runId}:${open}`);
  // A harness often ends its transcript on the very words the run reported
  // (its own API error as its last text): then the log below says them, and
  // the reported block would only repeat them. A reason the run row alone
  // keeps — a watchdog's, a refused start's — still shows.
  const reported = failure?.error?.trim();
  const reportedInLog =
    reported !== undefined &&
    op !== null &&
    [...(op.liveTimeline ?? []).map((part) => part.text), op.progressText].some(
      (text) => text?.trim() === reported,
    );

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-3xl">
        {/* `pr-8` keeps a long title clear of the corner Close. */}
        <ResponsiveDialogTitle className="flex items-center gap-2 pr-8 text-base font-semibold">
          {live
            ? t('run.detailsTitleLive', { name })
            : t('run.detailsTitle', { name })}
          {live && (
            <Loader2
              className="text-muted-foreground size-4 shrink-0 animate-spin"
              aria-hidden
            />
          )}
        </ResponsiveDialogTitle>
        {failure !== undefined && (
          <Stack gap={2}>
            <Text as="p">
              {t(
                `agentRun.failure.${taskRunFailureClass(failure.failureCode)}`,
              )}
            </Text>
            {failure.error !== undefined && !reportedInLog && (
              <Stack gap={1}>
                <Text as="h3" variant="label">
                  {t('agentRun.reported')}
                </Text>
                <Text
                  as="p"
                  variant="muted"
                  className="bg-muted/50 rounded-md px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
                >
                  {failure.error}
                </Text>
              </Stack>
            )}
          </Stack>
        )}
        {op !== null ? (
          <ExecutionLogView op={op} hideHeader className="max-h-[60vh]" />
        ) : readStatus === 'failed' ? (
          <div ref={retryFocus.ref}>
            <Alert variant="destructive" title={t('agentRun.logReadFailed')}>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={() => {
                  retryFocus.arm();
                  void opQuery.refetch();
                }}
              >
                {tCommon('actions.tryAgain')}
              </Button>
            </Alert>
          </div>
        ) : readStatus === 'ready' ? (
          // A failed run said why above; "no log" would only repeat that it
          // never got to work.
          failure === undefined && (
            <Text as="p" variant="muted">
              {tAutomations('runs.agentLog.empty')}
            </Text>
          )
        ) : (
          <Row gap={2} role="status">
            <Loader2
              className="text-muted-foreground size-4 animate-spin"
              aria-hidden
            />
            <Text variant="muted">{tCommon('actions.loading')}</Text>
          </Row>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

export function TaskAgentRunEntry({
  organizationId,
  taskId,
  assigneeId,
  canEdit,
  canStopRun,
  assigneeLive = true,
}: TaskAgentRunEntryProps) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');
  // Kicking a run is for whoever may work the task (an editor, or the
  // member it belongs to), with an agent that can actually run it.
  const canKick = canEdit && assigneeLive;
  const runQuery = useBackendQuery(
    'tasks/queries:getLatestTaskAgentRunForTask',
    { organizationId, taskId },
  );
  const { start, cancel, busy } = useTaskAgentRunControls(taskId);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const run = runQuery.data;
  const readStatus =
    run !== undefined
      ? 'ready'
      : runQuery.isFetching
        ? 'loading'
        : runQuery.isError
          ? 'failed'
          : 'loading';
  const retryFocus = useRetryFocus(readStatus, `${organizationId}:${taskId}`);
  if (readStatus === 'failed') {
    return (
      <div ref={retryFocus.ref} className="min-w-0">
        <Alert variant="destructive" title={t('agentRun.runReadFailed')}>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              retryFocus.arm();
              void runQuery.refetch();
            }}
          >
            {tCommon('actions.tryAgain')}
          </Button>
        </Alert>
      </div>
    );
  }
  if (run === undefined) return null;
  const live =
    run !== null && (run.status === 'queued' || run.status === 'running');
  const canStop =
    live && (canStopRun === undefined ? canEdit : canStopRun(run.startedBy));
  const previousAssignee = run !== null && run.agentId !== assigneeId;

  // No run yet: the agent lane's explicit entry point — the same kick the
  // board's drag-to-In-progress performs, as one small verb. Readers see
  // nothing until a run exists.
  if (run === null) {
    if (!canKick) return null;
    return (
      <Stack gap={1} className="min-w-0">
        <Row gap={2}>
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            icon={Play}
            onClick={() => void start()}
          >
            {t('agentRun.start')}
          </Button>
        </Row>
        {/* Assigning an agent does not start it — said where the person is
            looking when nothing happens. */}
        <Text variant="caption" className="text-muted-foreground text-pretty">
          {t('agentRun.notStartedYet')}
        </Text>
      </Stack>
    );
  }

  const waiting = isAgentRunWaiting(run);
  const statusLabel = waiting
    ? t(`agentRun.waiting.${waitingCopyKey(run.waitingReason)}`)
    : t(`agentRun.status.${run.status}`);

  return (
    <Stack gap={1} className="min-w-0">
      {previousAssignee && (
        <Text variant="caption" className="text-muted-foreground text-pretty">
          {t('agentRun.previousRun', { name: run.agentName ?? run.harness })}
        </Text>
      )}
      {/* The status itself opens the transcript. A separate Details verb made
          this narrow property row wrap; the status is the obvious target. */}
      <Row align="center" gap={2} className="min-w-0">
        <button
          type="button"
          className="focus-visible:ring-ring inline-flex min-w-0 items-center gap-2 rounded-md text-left focus-visible:ring-1 focus-visible:outline-none"
          onClick={() => setDetailsOpen(true)}
          aria-label={statusLabel}
        >
          {run.status === 'failed' ? (
            <Badge variant="destructive" icon={XCircle}>
              {statusLabel}
            </Badge>
          ) : (
            <>
              {live ? (
                <Loader2
                  aria-hidden
                  className="text-muted-foreground size-3.5 shrink-0 animate-spin"
                />
              ) : (
                <StatusIndicator
                  size="sm"
                  variant={run.status === 'settled' ? 'success' : 'neutral'}
                />
              )}
              <Text
                as="span"
                variant="caption"
                className="min-w-0 truncate font-medium"
                title={`${run.harness} · ${run.model}`}
              >
                {statusLabel}
              </Text>
            </>
          )}
        </button>
        {canKick &&
        !live &&
        !previousAssignee &&
        (run.status === 'failed' || run.status === 'cancelled') ? (
          <Button
            variant="ghost"
            size="icon"
            aria-label={t('agentRun.retry')}
            disabled={busy}
            onClick={() => void start()}
          >
            <RotateCcw aria-hidden className="size-4" />
          </Button>
        ) : null}
      </Row>
      {/* A waiting run says why it waits, so nobody reads a long wait as a
          stuck run (and Stop withdraws it like any live run). */}
      {waiting ? (
        <TaskAgentRunWaitingNote
          organizationId={organizationId}
          reason={run.waitingReason}
        />
      ) : null}
      {/* A run the platform re-kicked by itself says so — otherwise a user
          who watched the run fail sees it silently "running" again and
          cannot tell their Retry from the machine's. A resume after the
          broker refreshed the token under the run spends no attempt: it
          shows the count the cut run showed, and where that run showed
          none (0) says what happened instead. */}
      {live &&
      run.trigger === 'auto_retry' &&
      run.autoRetryAttempt !== undefined ? (
        <Text variant="caption" className="text-muted-foreground">
          {run.autoRetryAttempt === 0
            ? t('agentRun.resumedAfterTokenRefresh')
            : t('agentRun.autoRetrying', {
                n: run.autoRetryAttempt,
                max: run.autoRetryMax,
              })}
        </Text>
      ) : null}
      <Row gap={1} className="-ml-2 flex-wrap">
        {canStop ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void cancel()}
          >
            {t('agentRun.cancel')}
          </Button>
        ) : null}
        {canKick && !live && previousAssignee ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void start()}
          >
            {t('agentRun.start')}
          </Button>
        ) : null}
      </Row>
      <TaskAgentRunDetailsDialog
        organizationId={organizationId}
        runId={run._id}
        name={run.agentName ?? run.harness}
        live={live}
        {...(run.status === 'failed'
          ? {
              failure: {
                ...(run.failureCode !== undefined
                  ? { failureCode: run.failureCode }
                  : {}),
                ...(run.error !== undefined ? { error: run.error } : {}),
              },
            }
          : {})}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </Stack>
  );
}
