'use client';

/**
 * The automation lane's compact work strip, the twin of
 * `TaskAgentRunEntry` in the task modal's property panel: the task's LATEST
 * subject-linked automation run as one state badge plus Details, in every
 * state. The subject panel in the task body owns the verbs (Start, Cancel,
 * Approve …) and shows Details only while a run is live; this row is what
 * keeps a finished run's step timeline one click away afterwards, so a
 * result — or a failure — can still be audited from the task it worked.
 */

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { RunBadge } from '@/app/features/automations/components/run-status-badge';
import type { AutomationRunForTask } from '@/app/lib/backend/contract/automations';
import { useT } from '@/lib/i18n/client';

import { TaskRunDetailsDialog } from './task-run-details-dialog';

/** A run that is still moving: queued, running, or parked on a question. */
export function isLiveAutomationRun(run: AutomationRunForTask): boolean {
  return (
    run.status === 'queued' ||
    run.status === 'running' ||
    run.status === 'waiting'
  );
}

export function TaskAutomationRunEntry({
  organizationId,
  projectId,
  run,
  name,
}: {
  organizationId: string;
  projectId: string;
  /** The latest run — the caller renders nothing before one exists. */
  run: AutomationRunForTask;
  /** The automation's declared display name, for the dialog's title. */
  name: string;
}) {
  const { t } = useT('tasks');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const live = isLiveAutomationRun(run);

  return (
    <Stack gap={1} className="min-w-0">
      <Row align="center" gap={2} className="min-w-0">
        <RunBadge status={run.status} />
      </Row>
      <Row gap={1} className="-ml-2">
        {/* Reading the steps is a READ — offered to every viewer, for live
            and finished runs alike. */}
        <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(true)}>
          {t('run.details')}
        </Button>
      </Row>
      <TaskRunDetailsDialog
        organizationId={organizationId}
        projectId={projectId}
        automationSlug={run.name}
        runId={run.runId}
        name={name}
        live={live}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </Stack>
  );
}
