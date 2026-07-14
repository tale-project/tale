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
import { Card } from '@tale/ui/card';
import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { Row, Stack } from '@tale/ui/layout';
import { SkeletonText } from '@tale/ui/skeleton';
import { StatusIndicator } from '@tale/ui/status-indicator';
import { Text } from '@tale/ui/text';
import { PackageCheck } from 'lucide-react';
import type { ReactNode } from 'react';

import { EmbeddedRun } from '@/app/features/operator/components/embedded-run';
import { TaskComments } from '@/app/features/tasks/components/task-comments';
import { useTask, useTaskDiscussion } from '@/app/features/tasks/hooks/queries';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { isActiveExecutionStatus } from '@/lib/shared/platform/run_capacity';

import { useAutomationRuntime } from '../../runtime/automation-runtime';
import { SubjectInputPanel } from './subject-input-panel';

function TaskExpandComments({
  taskId,
  runActive,
}: {
  taskId: string;
  /** The subject's latest run is still executing — comments posted now won't
   *  reach it (runs read the timeline when they start), so warn at the composer. */
  runActive: boolean;
}) {
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
        {/* Newest-first: this thread is a run log — the latest automated
            comment (figures, question, ⚠️) is what the operator opens it for. */}
        <TaskComments
          taskId={task._id}
          organizationId={task.organizationId}
          projectId={task.projectId}
          canComment={canComment}
          currentUserId={me?.userId}
          isAdmin={me?.isAdmin}
          showHeading={false}
          order="desc"
          composerHint={runActive ? t('detail.commentsDuringRun') : undefined}
        />
      </div>
    </CollapsibleDetails>
  );
}

/**
 * The Outcome section's no-run twin — same card chrome and heading as the
 * operator `OutcomeStrip`, so the expanded panel keeps its fixed anatomy
 * (Input · Outcome · Comments · Run details) before the first run exists.
 */
function OutcomePlaceholder({ promises }: { promises?: string[] }) {
  const { t: tOperator } = useT('operator');
  const hasPromises = promises !== undefined && promises.length > 0;
  return (
    <Card asChild padding="none" shadow="sm">
      <section>
        <Row gap={3} align="center" justify="between" className="p-5 pb-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <Row
              gap={0}
              justify="center"
              className="bg-muted text-muted-foreground size-8 shrink-0 rounded-md"
            >
              <PackageCheck className="size-4" aria-hidden />
            </Row>
            <Text as="span" className="font-semibold">
              {tOperator('section.outcome', { defaultValue: 'Outcome' })}
            </Text>
          </div>
          {hasPromises && (
            <Text variant="muted" className="shrink-0 text-sm">
              {tOperator('outcome.pendingHint', {
                defaultValue: 'Not ready yet.',
              })}
            </Text>
          )}
        </Row>
        <div className="px-5 pb-5">
          {hasPromises ? (
            // The pack-declared deliverables as static slots — the same rows
            // OutcomeStrip shows while a run is in flight, minus the pulse.
            <ul className="flex flex-col gap-2">
              {promises.map((name) => (
                <li key={name}>
                  <StatusIndicator variant="neutral" size="sm">
                    {name}
                  </StatusIndicator>
                </li>
              ))}
            </ul>
          ) : (
            <Text variant="muted">
              {tOperator('outcome.empty', {
                defaultValue:
                  'No results yet — they will appear here once a run produces them.',
              })}
            </Text>
          )}
        </div>
      </section>
    </Card>
  );
}

export function SubjectRun({
  subjectType,
  subjectId,
  input,
  promisedOutcomes,
}: {
  subjectType: string;
  subjectId: string;
  /** The Input section rendered at the top of the panel (e.g. the bound
   *  folder's upload card) — supplied by the hosting block. */
  input?: ReactNode;
  /** Pack-declared deliverable names shown as static Outcome slots before
   *  the first run exists (e.g. return.xml). */
  promisedOutcomes?: string[];
}) {
  const { t } = useT('automations');
  const { t: tOperator } = useT('operator');
  const { organizationId } = useAutomationRuntime();
  const { data, isLoading } = useConvexQuery(
    api.workflow_executions.queries.getLatestExecutionForSubject,
    { organizationId, subjectType, subjectId },
  );

  const isTask = subjectType === 'task';
  // The comment thread outranks the process machinery for an operator, so it
  // slots in ABOVE the collapsed "Run details" (below the Outcome). Without a
  // run to embed, it simply follows the placeholder.
  const runActive = data != null && isActiveExecutionStatus(data.status);
  const comments = isTask ? (
    <TaskExpandComments taskId={subjectId} runActive={runActive} />
  ) : null;

  const runBody = (() => {
    if (isLoading && data === undefined) return <SkeletonText lines={4} />;
    if (!data) return <Text variant="muted">{t('runs.none')}</Text>;
    return (
      <EmbeddedRun
        organizationId={organizationId}
        executionId={data.executionId}
        showRerun={false}
        beforeDetails={comments}
      />
    );
  })();

  if (!isTask) return runBody;

  // Fixed panel anatomy — Input · Outcome · Comments · Run details — in every
  // state: before the first run the Outcome and Run-details sections render
  // their empty twins instead of collapsing the structure to one bare line.
  return (
    <Stack gap={3} className="pt-3">
      {input}
      <SubjectInputPanel subjectType={subjectType} subjectId={subjectId} />
      {isLoading && data === undefined ? (
        <SkeletonText lines={4} />
      ) : data ? (
        runBody
      ) : (
        <>
          <OutcomePlaceholder promises={promisedOutcomes} />
          {comments}
          <CollapsibleDetails
            summary={
              <Text as="span" className="font-medium">
                {tOperator('section.runDetails', {
                  defaultValue: 'Run details',
                })}
              </Text>
            }
          >
            <div className="mt-3">
              <Text variant="muted">{t('runs.none')}</Text>
            </div>
          </CollapsibleDetails>
        </>
      )}
    </Stack>
  );
}
