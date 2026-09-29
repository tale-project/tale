'use client';

/**
 * The agent lane's compact work strip, subordinate to the Assignee field in
 * the task modal's property panel — the run is the ASSIGNEE's state, not a
 * second subject, so it reads as one status line plus small verbs instead of
 * a card competing with the task body. Shows the task's LATEST agent run —
 * live with Cancel, failed with its error + Retry (a failed run keeps the
 * task at In progress — failure is the run's state, not the task's), settled
 * as "reported for review" (the report itself is the agent's comment in the
 * timeline) — and, before any run exists, an explicit Start so kicking the
 * agent never requires knowing the drag verb. Every run offers Details: the
 * agent's sandbox transcript, live while it works and preserved after it
 * settles.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { toast } from '@tale/ui/use-toast';
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { ExecutionLogView } from '@/app/features/automations/components/agent-execution-log';
import { useBackendQuery } from '@/app/hooks/use-backend-query';
import { failureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import {
  useCancelTaskAgentRun,
  useStartTaskAgentRun,
} from '../hooks/mutations';
import { taskRunErrorMessage } from '../lib/task-run-error';

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

/** The start refusal's reason, as a sentence the user can act on. */
function notStartedMessage(
  t: (key: string) => string,
  reason: string | undefined,
): string {
  switch (reason) {
    case 'agent_missing':
    case 'agent_unavailable':
      return t('agentRun.agentMissing');
    case 'no_agent_assignee':
      return t('agentRun.noAgentAssignee');
    default:
      return t('agentRun.notStarted');
  }
}

/**
 * The run's sandbox transcript, inspected WITHOUT leaving the task — the
 * agent twin of the subject panel's `TaskRunDetailsDialog`. Nothing is
 * fetched until it opens; a run whose turn has not written its op yet (or
 * whose op was torn down) degrades to the empty line.
 */
function TaskAgentRunDetailsDialog({
  organizationId,
  runId,
  name,
  live,
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
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const { t: tAutomations } = useT('automations');
  const opQuery = useBackendQuery(
    'tasks/queries:getTaskAgentRunSandboxOp',
    open ? { organizationId, runId } : 'skip',
  );
  const op = opQuery.data ?? null;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-3xl">
        <ResponsiveDialogTitle className="flex items-center gap-2 text-base font-semibold">
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
        {op !== null ? (
          <ExecutionLogView op={op} hideHeader className="max-h-[60vh]" />
        ) : opQuery.data === null ? (
          <Text as="p" variant="muted">
            {tAutomations('runs.agentLog.empty')}
          </Text>
        ) : (
          <Loader2
            className="text-muted-foreground size-4 animate-spin"
            aria-hidden
          />
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
  // Kicking a run is for whoever may work the task (an editor, or the
  // member it belongs to), with an agent that can actually run it.
  const canKick = canEdit && assigneeLive;
  const runQuery = useBackendQuery(
    'tasks/queries:getLatestTaskAgentRunForTask',
    { organizationId, taskId },
  );
  const { mutateAsync: startRun } = useStartTaskAgentRun();
  const { mutateAsync: cancelRun } = useCancelTaskAgentRun({
    errorToast: false,
  });
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const run = runQuery.data;
  if (run === undefined) return null;
  const live =
    run !== null && (run.status === 'queued' || run.status === 'running');
  const canStop =
    live && (canStopRun === undefined ? canEdit : canStopRun(run.startedBy));
  const previousAssignee = run !== null && run.agentId !== assigneeId;

  const handleRetry = async () => {
    setBusy(true);
    try {
      const result = await startRun({ taskId });
      if (result.started) {
        toast({ title: t('agentRun.started'), variant: 'success' });
      } else if (result.reason === 'already_running') {
        toast({ title: t('agentRun.alreadyRunning') });
      } else {
        toast({
          title: notStartedMessage(t, result.reason),
          variant: 'destructive',
        });
      }
    } catch (error) {
      console.error('startTaskAgentRun failed', error);
      const known = taskRunErrorMessage(error, t);
      toast({
        title: known ?? t('agentRun.notStarted'),
        // A refusal named above is the whole story; any other says why.
        description: known === undefined ? failureDetail(error) : undefined,
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  const handleCancel = async () => {
    setBusy(true);
    try {
      await cancelRun({ taskId });
      toast({ title: t('agentRun.cancelled') });
    } catch (error) {
      console.error('cancelTaskAgentRun failed', error);
      toast({
        title: t('agentRun.cancelFailed'),
        description: failureDetail(error),
        variant: 'destructive',
      });
    } finally {
      setBusy(false);
    }
  };

  // No run yet: the agent lane's explicit entry point — the same kick the
  // board's drag-to-In-progress performs, as one small verb. Readers see
  // nothing until a run exists.
  if (run === null) {
    if (!canKick) return null;
    return (
      <Row gap={2}>
        <Button
          size="sm"
          variant="secondary"
          disabled={busy}
          icon={Play}
          onClick={() => void handleRetry()}
        >
          {t('agentRun.start')}
        </Button>
      </Row>
    );
  }

  return (
    <Stack gap={1} className="min-w-0">
      {previousAssignee && (
        <Text variant="caption" className="text-muted-foreground text-pretty">
          {t('agentRun.previousRun', { name: run.agentName ?? run.harness })}
        </Text>
      )}
      {/* One word + one signal: a spinner while the run moves, a coloured
          state dot once it stopped. The agent identity lives in the Assignee
          row right above; harness · model stay one hover away. */}
      <Row align="center" gap={2} className="min-w-0">
        {live ? (
          <Loader2
            aria-hidden
            className="text-muted-foreground size-3.5 shrink-0 animate-spin"
          />
        ) : (
          <StatusIndicator
            size="sm"
            variant={
              run.status === 'settled'
                ? 'success'
                : run.status === 'failed'
                  ? 'error'
                  : 'neutral'
            }
          />
        )}
        <Text
          as="span"
          variant="caption"
          className="min-w-0 truncate font-medium"
          title={`${run.harness} · ${run.model}`}
        >
          {/* A capacity-parked run is honest about WHAT it is queued on —
              a bare "Queued" reads as "about to start" while the org's
              sandbox budget may hold it for a while. */}
          {run.status === 'queued' && run.waitingForCapacity === true
            ? t('agentRun.waitingForSlot')
            : t(`agentRun.status.${run.status}`)}
        </Text>
      </Row>
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
      {run.status === 'failed' && run.error !== undefined ? (
        <Text
          variant="caption"
          className="text-destructive line-clamp-2 text-pretty"
        >
          {run.error}
        </Text>
      ) : null}
      <Row gap={1} className="-ml-2">
        {/* Reading the transcript is a READ — offered to every viewer, for
            live and settled runs alike. */}
        <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(true)}>
          {t('run.details')}
        </Button>
        {canStop ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleCancel()}
          >
            {t('agentRun.cancel')}
          </Button>
        ) : null}
        {canKick &&
        !live &&
        (previousAssignee ||
          run.status === 'failed' ||
          run.status === 'cancelled') ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleRetry()}
          >
            {t(previousAssignee ? 'agentRun.start' : 'agentRun.retry')}
          </Button>
        ) : null}
      </Row>
      <TaskAgentRunDetailsDialog
        organizationId={organizationId}
        runId={run._id}
        name={run.agentName ?? run.harness}
        live={live}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </Stack>
  );
}
