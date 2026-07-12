'use client';

/**
 * Resolves the latest workflow run "about" a domain resource (subjectType,
 * subjectId) and renders it inline via the reusable `EmbeddedRun`. This is the
 * fusion seam: any domain component (a task row now; others later) drops in
 * `<SubjectRun>` to show its execution detail in-context — no per-component
 * backend field (the link is the generic `subjectType`/`subjectId` on the
 * execution).
 *
 * For task subjects, also mounts the task comment thread (collapsed by default,
 * same disclosure pattern as Run details) so desk operators can leave
 * Request-changes feedback without a separate detail dialog.
 *
 * Reads the fixed platform query directly (like the operator feature), not via
 * the automation allowlist — that gates automation-AUTHORED view bindings, whereas this is
 * platform code reading org-RLS-gated execution data.
 */
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';

import { EmbeddedRun } from '@/app/features/operator/components/embedded-run';
import { TaskComments } from '@/app/features/tasks/components/task-comments';
import { useTask, useTaskDiscussion } from '@/app/features/tasks/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAutomationRuntime } from '../../runtime/automation-runtime';
import { SubjectInputPanel } from './subject-input-panel';

function TaskExpandComments({ taskId }: { taskId: string }) {
  const { t } = useT('automations');
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- subjectId for subjectType=task is a tasks id
  const id = taskId as Id<'tasks'>;
  const { task, canComment } = useTask(id);
  const { comments } = useTaskDiscussion(id);
  const { data: me } = useCurrentMemberContext(task?.organizationId);
  if (!task) return null;
  return (
    <CollapsibleDetails
      summary={
        <Text as="span" className="font-medium">
          {t('detail.comments')} ({comments.length})
        </Text>
      }
    >
      <div className="mt-3">
        <TaskComments
          taskId={task._id}
          organizationId={task.organizationId}
          projectId={task.projectId}
          canComment={canComment}
          currentUserId={me?.userId}
          isAdmin={me?.isAdmin}
          showHeading={false}
        />
      </div>
    </CollapsibleDetails>
  );
}

export function SubjectRun({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { t } = useT('automations');
  const { organizationId } = useAutomationRuntime();
  const { data, isLoading } = useConvexQuery(
    api.workflow_executions.queries.getLatestExecutionForSubject,
    { organizationId, subjectType, subjectId },
  );

  const runBody = (() => {
    if (isLoading && data === undefined) return <SkeletonText lines={4} />;
    if (!data) return <Text variant="muted">{t('runs.none')}</Text>;
    return (
      <EmbeddedRun
        organizationId={organizationId}
        executionId={data.executionId}
        showRerun={false}
      />
    );
  })();

  if (subjectType !== 'task') return runBody;

  return (
    <Stack gap={3}>
      <SubjectInputPanel subjectType={subjectType} subjectId={subjectId} />
      {runBody}
      <TaskExpandComments taskId={subjectId} />
    </Stack>
  );
}
