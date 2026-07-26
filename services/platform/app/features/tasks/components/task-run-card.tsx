'use client';

import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { Workflow } from 'lucide-react';

import {
  RunApprovalCard,
  approvalIdFromDetail,
} from '@/app/features/automations/components/run-approval-card';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

/**
 * The live-run surface INSIDE the task modal, so operating an automation-owned
 * task never requires the automation pages: while the owning run is in
 * flight this shows what it is doing, and when it parks on a write approval
 * the approve/reject decision renders right here. Renders nothing when no
 * run is live.
 */
export function TaskRunCard({
  organizationId,
  task,
}: {
  organizationId: string;
  task: { _id: Id<'tasks'>; projectId: Id<'projects'> };
}) {
  const { t } = useT('tasks');
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
        <Link
          to="/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId"
          params={{
            id: organizationId,
            projectId: task.projectId,
            automationSlug: automationSlugToParam(run.name),
            runId: run.runId,
          }}
          className="text-muted-foreground hover:text-foreground text-xs underline-offset-2 hover:underline"
        >
          {t('run.viewRun')}
        </Link>
      </Row>
      {approvalId !== undefined && (
        <RunApprovalCard
          organizationId={organizationId}
          approvalId={approvalId}
        />
      )}
    </div>
  );
}
