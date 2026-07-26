'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { Text } from '@tale/ui/text';
import { Workflow } from 'lucide-react';
import { useState } from 'react';

import { EffectList } from '@/app/features/automations/components/effect-list';
import {
  RunApprovalCard,
  approvalIdFromDetail,
} from '@/app/features/automations/components/run-approval-card';
import { RunStatusBadge } from '@/app/features/automations/components/run-status-badge';
import { useAutomationRun } from '@/app/features/automations/hooks/queries';
import { projectRun } from '@/app/features/automations/lib/run-view';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

/**
 * The run's progress, inspected WITHOUT leaving the task: a dialog listing
 * each traced node with its state plus every effect performed so far. The
 * full run document is only fetched while the dialog is open.
 */
function TaskRunDetailsDialog({
  organizationId,
  runId,
  name,
  open,
  onOpenChange,
}: {
  organizationId: string;
  runId: Id<'automationRuns'>;
  name: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const runQuery = useAutomationRun(organizationId, open ? runId : undefined);
  const run = runQuery.data ?? null;
  const projection = projectRun(run);
  const nodes = [...projection.byNode.entries()];
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="flex max-h-[85vh] flex-col gap-4 overflow-y-auto md:max-w-xl">
        <ResponsiveDialogTitle className="text-base font-semibold">
          {t('run.detailsTitle', { name })}
        </ResponsiveDialogTitle>
        {run !== null && (
          <>
            <Stack as="section" gap={1}>
              {nodes.length === 0 ? (
                <Text as="p" variant="muted">
                  {t('run.noProgressYet')}
                </Text>
              ) : (
                <ul className="flex flex-col gap-1">
                  {nodes.map(([nodeId, view]) => (
                    <li
                      key={nodeId}
                      className="flex items-center justify-between gap-2 text-sm"
                    >
                      <span className="min-w-0 truncate">{nodeId}</span>
                      <RunStatusBadge status={view.status} />
                    </li>
                  ))}
                </ul>
              )}
            </Stack>
            <Stack as="section" gap={2}>
              <Text as="h3" variant="label">
                {t('run.effectsTitle')}
              </Text>
              <EffectList
                effects={projection.effects}
                emptyMessage={t('run.noEffectsYet')}
              />
            </Stack>
          </>
        )}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}

/**
 * The live-run surface INSIDE the task modal, so operating an automation-owned
 * task never requires the automation pages: while the owning run is in
 * flight this shows what it is doing, run details open in a dialog right
 * here, and when the run parks on a write approval the approve/reject
 * decision renders in place. Renders nothing when no run is live.
 */
export function TaskRunCard({
  organizationId,
  task,
}: {
  organizationId: string;
  task: { _id: Id<'tasks'>; projectId: Id<'projects'> };
}) {
  const { t } = useT('tasks');
  const [detailsOpen, setDetailsOpen] = useState(false);
  const runQuery = useConvexQuery(api.automations.queries.getLiveRunForTask, {
    organizationId,
    projectId: task.projectId,
    taskId: task._id,
  });
  const run = runQuery.data ?? null;
  if (run === null) return null;

  const approvalId = approvalIdFromDetail(run.detail);
  return (
    <div className="border-border bg-muted/30 flex flex-col gap-3 rounded-lg border p-3">
      <Row gap={2} align="center">
        <Workflow
          className="text-muted-foreground size-4 shrink-0"
          aria-hidden
        />
        <Text
          as="p"
          variant="muted"
          className="min-w-0 flex-1 truncate text-sm"
        >
          {t('run.working', { name: run.name })}
        </Text>
        <Button variant="ghost" size="sm" onClick={() => setDetailsOpen(true)}>
          {t('run.details')}
        </Button>
      </Row>
      {approvalId !== undefined && (
        <RunApprovalCard
          organizationId={organizationId}
          approvalId={approvalId}
        />
      )}
      <TaskRunDetailsDialog
        organizationId={organizationId}
        runId={run.runId}
        name={run.name}
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
      />
    </div>
  );
}
