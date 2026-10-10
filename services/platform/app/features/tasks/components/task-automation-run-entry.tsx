'use client';

/**
 * The automation lane's compact work strip, the twin of
 * `TaskAgentRunEntry` in the task modal's property panel: the task's LATEST
 * subject-linked automation run as one state badge in every state. The task
 * activity thread owns the run result, keeping it beside the event that
 * produced it instead of duplicating it in the property bar.
 */

import { Stack } from '@tale/ui/layout';

import { RunBadge } from '@/app/features/automations/components/run-status-badge';
import type { AutomationRunForTask } from '@/app/lib/backend/contract/automations';

/** A run that is still moving: queued, running, or parked on a question. */
export function isLiveAutomationRun(run: AutomationRunForTask): boolean {
  return (
    run.status === 'queued' ||
    run.status === 'running' ||
    run.status === 'waiting'
  );
}

export function TaskAutomationRunEntry({
  run,
}: {
  /** The latest run — the caller renders nothing before one exists. */
  run: AutomationRunForTask;
}) {
  return (
    <Stack gap={1} className="min-w-0">
      <RunBadge status={run.status} />
    </Stack>
  );
}
