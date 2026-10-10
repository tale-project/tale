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
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { useRetryFocus } from '@tale/ui/use-retry-focus';
import { CheckCircle2, Loader2, Play, RotateCcw, XCircle } from 'lucide-react';

import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { useT } from '@/lib/i18n/client';

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
      {/* Run output belongs in the activity thread; the property bar only
          exposes the current state and available controls. */}
      <Row align="center" gap={2} className="min-w-0">
        <button
          type="button"
          className="inline-flex min-w-0 items-center gap-2 rounded-md text-left"
          aria-label={statusLabel}
          disabled
        >
          {run.status === 'failed' ? (
            <Badge variant="destructive" icon={XCircle}>
              {statusLabel}
            </Badge>
          ) : run.status === 'settled' ? (
            <Badge variant="green" icon={CheckCircle2}>
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
                <StatusIndicator size="sm" variant="neutral" />
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
    </Stack>
  );
}
