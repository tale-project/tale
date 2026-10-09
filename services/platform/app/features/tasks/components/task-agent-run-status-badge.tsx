'use client';

/**
 * Status badge on a task Activity agent-run row. Running / Failed / Timed out
 * (and Completed) open a ViewDialog with the stored run outcome. The embedded
 * live-run transcript that used to render for a linked workflow execution is
 * offline while the automations backend is rebuilt, so a linked execution
 * shows the "no live detail" notice. A failed run leads with what its failure
 * means (`lib/shared/task-run-failure.ts`) and keeps the stored `error`
 * string below it as what the run reported.
 */
import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import { ViewDialog } from '@tale/ui/dialog/view-dialog';
import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { taskRunFailureClass } from '@/lib/shared/task-run-failure';

import type { TaskAgentRunRow } from '../utils/task-timeline';

type AgentRunVariant = 'outline' | 'green' | 'destructive' | 'yellow';
const STATUS_VARIANT: Record<string, AgentRunVariant> = {
  running: 'outline',
  completed: 'green',
  failed: 'destructive',
  timed_out: 'yellow',
};

const OPENABLE_STATUSES = new Set([
  'running',
  'failed',
  'timed_out',
  'completed',
]);

export function TaskAgentRunStatusBadge({
  run,
  agentName,
}: {
  run: TaskAgentRunRow;
  agentName: string;
}) {
  const { t } = useT('tasks');
  const [open, setOpen] = useState(false);
  const statusLabel = t(`agentRuns.status.${run.status}`);
  const canOpen = OPENABLE_STATUSES.has(run.status);

  const badge = (
    <Badge
      variant={STATUS_VARIANT[run.status] ?? 'outline'}
      className={cn('text-[10px]', canOpen && 'cursor-pointer')}
    >
      {statusLabel}
    </Badge>
  );

  if (!canOpen) return badge;

  const dialogTitle =
    run.status === 'running'
      ? t('agentRuns.detail.runningTitle', { agent: agentName })
      : run.status === 'completed'
        ? t('agentRuns.detail.completedTitle', { agent: agentName })
        : t('agentRuns.detail.failedTitle', { agent: agentName });

  return (
    <>
      <button
        type="button"
        className="focus-visible:ring-ring inline-flex rounded-md focus-visible:ring-1 focus-visible:outline-none"
        onClick={(e) => {
          e.stopPropagation();
          setOpen(true);
        }}
        aria-label={t('agentRuns.detail.openAria', {
          status: statusLabel,
          agent: agentName,
        })}
      >
        {badge}
      </button>
      <ViewDialog
        open={open}
        onOpenChange={setOpen}
        title={dialogTitle}
        size="wide"
      >
        {run.status === 'failed' ? (
          <Stack gap={3} className="mt-4">
            <Text as="p">
              {t(`agentRun.failure.${taskRunFailureClass(run.failureCode)}`)}
            </Text>
            {run.error ? (
              <Stack gap={1}>
                <Text as="h3" variant="label">
                  {t('agentRun.reported')}
                </Text>
                <Text
                  as="p"
                  variant="muted"
                  className="bg-muted/50 rounded-md px-3 py-2 font-mono text-xs break-words whitespace-pre-wrap"
                >
                  {run.error}
                </Text>
              </Stack>
            ) : null}
          </Stack>
        ) : run.error ? (
          <Text as="p" variant="error" className="mt-4 whitespace-pre-wrap">
            {run.error}
          </Text>
        ) : (
          <Text as="p" variant="muted" className="mt-4">
            {t('agentRuns.detail.noLiveDetail')}
          </Text>
        )}
      </ViewDialog>
    </>
  );
}
