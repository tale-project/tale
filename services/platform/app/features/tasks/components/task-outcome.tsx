'use client';

import { Stack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';

import {
  OutcomeRows,
  outcomeSteps,
} from '@/app/features/operator/components/outcome-strip';
import { useExecutionProjection } from '@/app/features/operator/hooks/use-execution-projection';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

/**
 * The task detail's Outcome section: the latest subject run's deliverables,
 * on the SAME contract as the desk row's OutcomeStrip — steps annotated
 * `ui.params.surface: "outcome"`, whatever their artifact kind (documents
 * open in the preview dialog, plain files such as screenshots link out,
 * text renders as markdown; pending slots pulse while the run executes).
 * Renders nothing for tasks without a run, or whose pack declares no
 * outcome steps — ordinary board tasks are untouched.
 */
export function TaskOutcomeSection({
  organizationId,
  taskId,
}: {
  organizationId: string;
  taskId: Id<'tasks'>;
}) {
  const { data: run } = useConvexQuery(
    api.workflow_executions.queries.getLatestExecutionForSubject,
    { organizationId, subjectType: 'task', subjectId: taskId },
  );
  if (!run) return null;
  return (
    <TaskOutcomeBody
      organizationId={organizationId}
      executionId={run.executionId}
    />
  );
}

/** Split so the projection hook only mounts once a run exists. */
function TaskOutcomeBody({
  organizationId,
  executionId,
}: {
  organizationId: string;
  executionId: string;
}) {
  const { t } = useT('tasks');
  const { projection } = useExecutionProjection({
    organizationId,
    executionId,
  });
  if (!projection || outcomeSteps(projection).length === 0) return null;
  return (
    <Stack as="section" gap={2}>
      <Text as="h3" variant="label">
        {t('detail.outcome')}
      </Text>
      <OutcomeRows projection={projection} />
    </Stack>
  );
}
