'use client';

/**
 * The agent-ownership work panel of the task modal — the agent twin of the
 * automation `TaskSubjectPanel`. Shows the task's LATEST agent run — a live
 * one with progress + Cancel, a failed one with its error + Retry (a failed
 * run keeps the task at In progress — failure is the run's state, not the
 * task's), a settled one as "reported for review" (the report itself is the
 * agent's comment in the timeline below) — and, before any run exists, an
 * explicit Start so kicking the agent never requires knowing the drag verb.
 * Every run offers Details: the agent's sandbox transcript, live while it
 * works and preserved after it settles.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Bot, Loader2, Play } from 'lucide-react';
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
  open,
  onOpenChange,
}: {
  organizationId: string;
  runId: Id<'projectAgentRuns'>;
  name: string;
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
        <ResponsiveDialogTitle className="text-base font-semibold">
          {t('run.detailsTitle', { name })}
        </ResponsiveDialogTitle>
        {op !== null ? (
          <ExecutionLogView op={op} className="max-h-[60vh]" />
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

interface TaskAgentRunCardProps {
  organizationId: string;
  taskId: Id<'tasks'>;
  canEdit: boolean;
}

export function TaskAgentRunCard({
  organizationId,
  taskId,
  canEdit,
}: TaskAgentRunCardProps) {
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
  // board's drag-to-In-progress performs, as a visible button.
  if (run === null) {
    return (
      <section className="rounded-md border p-3">
        <Stack gap={2}>
          <Row align="center" gap={2} className="min-w-0">
            <Bot
              aria-hidden
              className="text-muted-foreground size-4 shrink-0"
            />
            <Text as="p" variant="muted" className="min-w-0 flex-1 text-sm">
              {t('agentRun.idle')}
            </Text>
          </Row>
          {canEdit && (
            <Row gap={2}>
              <Button
                size="sm"
                disabled={busy}
                icon={Play}
                onClick={() => void handleRetry()}
              >
                {t('agentRun.start')}
              </Button>
            </Row>
          )}
        </Stack>
      </section>
    );
  }

  return (
    <section className="rounded-md border p-3">
      <Stack gap={2}>
        <Row justify="between" align="center" gap={3}>
          <Row align="center" gap={2} className="min-w-0">
            {live ? (
              <Loader2
                aria-hidden
                className="text-muted-foreground size-4 shrink-0 animate-spin"
              />
            ) : (
              <Bot
                aria-hidden
                className="text-muted-foreground size-4 shrink-0"
              />
            )}
            <Text className="truncate font-medium">
              {t(`agentRun.status.${run.status}`)}
            </Text>
          </Row>
          <Text variant="caption" className="text-muted-foreground truncate">
            {run.harness} · {run.model}
          </Text>
        </Row>
        {run.status === 'failed' && run.error !== undefined ? (
          <Text variant="caption" className="text-destructive text-pretty">
            {run.error}
          </Text>
        ) : null}
        <Row gap={2}>
          {canEdit && live ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void handleCancel()}
            >
              {t('agentRun.cancel')}
            </Button>
          ) : null}
          {canEdit &&
          (run.status === 'failed' || run.status === 'cancelled') ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void handleRetry()}
            >
              {t('agentRun.retry')}
            </Button>
          ) : null}
          {/* Reading the transcript is a READ — offered to every viewer, for
              live and settled runs alike. */}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setDetailsOpen(true)}
          >
            {t('run.details')}
          </Button>
        </Row>
      </Stack>
      <TaskAgentRunDetailsDialog
        organizationId={organizationId}
        runId={run._id}
        name={run.agentName ?? run.harness}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </section>
  );
}
