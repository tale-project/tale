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
import { Loader2, Play } from 'lucide-react';
import { useState } from 'react';

import { ExecutionLogView } from '@/app/features/automations/components/agent-execution-log';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useCancelTaskAgentRun,
  useStartTaskAgentRun,
} from '../hooks/mutations';

interface TaskAgentRunEntryProps {
  organizationId: string;
  taskId: Id<'tasks'>;
  canEdit: boolean;
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
  runId: Id<'projectAgentRuns'>;
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
  const opQuery = useConvexQuery(
    api.tasks.queries.getTaskAgentRunSandboxOp,
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
  canEdit,
}: TaskAgentRunEntryProps) {
  const { t } = useT('tasks');
  const runQuery = useConvexQuery(
    api.tasks.queries.getLatestTaskAgentRunForTask,
    { organizationId, taskId },
  );
  const { mutateAsync: startRun } = useStartTaskAgentRun();
  const { mutateAsync: cancelRun } = useCancelTaskAgentRun();
  const [busy, setBusy] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);

  const run = runQuery.data;
  if (run === undefined) return null;
  const live =
    run !== null && (run.status === 'queued' || run.status === 'running');

  const handleRetry = async () => {
    setBusy(true);
    try {
      const result = await startRun({ taskId });
      if (result.started) {
        toast({ title: t('agentRun.started'), variant: 'success' });
      } else {
        toast({
          title:
            result.reason === 'already_running'
              ? t('agentRun.alreadyRunning')
              : t('agentRun.notStarted'),
          variant:
            result.reason === 'already_running' ? undefined : 'destructive',
        });
      }
    } catch (error) {
      console.error('startTaskAgentRun failed', error);
      toast({ title: t('agentRun.notStarted'), variant: 'destructive' });
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
      toast({ title: t('agentRun.notStarted'), variant: 'destructive' });
    } finally {
      setBusy(false);
    }
  };

  // No run yet: the agent lane's explicit entry point — the same kick the
  // board's drag-to-In-progress performs, as one small verb. Readers see
  // nothing until a run exists.
  if (run === null) {
    if (!canEdit) return null;
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
          cannot tell their Retry from the machine's. */}
      {live &&
      run.trigger === 'auto_retry' &&
      run.autoRetryAttempt !== undefined ? (
        <Text variant="caption" className="text-muted-foreground">
          {t('agentRun.autoRetrying', {
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
        {canEdit && live ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleCancel()}
          >
            {t('agentRun.cancel')}
          </Button>
        ) : null}
        {canEdit && (run.status === 'failed' || run.status === 'cancelled') ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={busy}
            onClick={() => void handleRetry()}
          >
            {t('agentRun.retry')}
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
