'use client';

/**
 * The agent-ownership work panel of the task modal — the agent twin of the
 * automation `TaskRunCard`. Shows the task's LATEST agent run: a live one
 * with progress + Cancel, a failed one with its error + Retry (a failed run
 * keeps the task at In progress — failure is the run's state, not the
 * task's), a settled one as "reported for review" (the report itself is the
 * agent's comment in the timeline below).
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Bot, Loader2 } from 'lucide-react';
import { useState } from 'react';

import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import {
  useCancelTaskAgentRun,
  useStartTaskAgentRun,
} from '../hooks/mutations';

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

  const run = runQuery.data;
  if (run === null || run === undefined) return null;
  const live = run.status === 'queued' || run.status === 'running';

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
        {canEdit &&
        (live || run.status === 'failed' || run.status === 'cancelled') ? (
          <Row gap={2}>
            {live ? (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void handleCancel()}
              >
                {t('agentRun.cancel')}
              </Button>
            ) : (
              <Button
                variant="secondary"
                size="sm"
                disabled={busy}
                onClick={() => void handleRetry()}
              >
                {t('agentRun.retry')}
              </Button>
            )}
          </Row>
        ) : null}
      </Stack>
    </section>
  );
}
