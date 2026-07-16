'use client';

/**
 * Status badge on a task Activity agent-run row. Running / Failed / Timed out
 * (and Completed when a workflow execution is linked) open a ViewDialog with
 * the live or terminal run detail — reusing `EmbeddedRun` when
 * `wfExecutionId` is present, otherwise the stored `error` string.
 */
import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { useState } from 'react';

import { ViewDialog } from '@/app/components/ui/dialog/view-dialog';
import { EmbeddedRun } from '@/app/features/operator/components/embedded-run';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { TaskAgentRunRow } from '../utils/task-timeline';

const STATUS_BADGE: Record<string, string> = {
  running: 'text-primary border-primary/40',
  completed: 'text-green-600 dark:text-green-400 border-green-500/40',
  failed: 'text-red-600 dark:text-red-400 border-red-500/40',
  timed_out: 'text-amber-600 dark:text-amber-400 border-amber-500/40',
};

const OPENABLE_STATUSES = new Set([
  'running',
  'failed',
  'timed_out',
  'completed',
]);

export function TaskAgentRunStatusBadge({
  organizationId,
  run,
  agentName,
}: {
  organizationId: string;
  run: TaskAgentRunRow;
  agentName: string;
}) {
  const { t } = useT('tasks');
  const [open, setOpen] = useState(false);
  const statusLabel = t(`agentRuns.status.${run.status}`);
  const canOpen = OPENABLE_STATUSES.has(run.status);

  const badge = (
    <Badge
      variant="outline"
      className={cn(
        'text-[10px]',
        STATUS_BADGE[run.status],
        canOpen && 'cursor-pointer',
      )}
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
        {run.wfExecutionId ? (
          <div className="mt-2">
            <EmbeddedRun
              organizationId={organizationId}
              executionId={run.wfExecutionId}
              showStop={run.status === 'running'}
              showRerun={run.status === 'failed' || run.status === 'timed_out'}
            />
          </div>
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
