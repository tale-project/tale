'use client';

/**
 * Resolves the latest workflow run "about" a domain resource (subjectType,
 * subjectId) and renders it inline via the reusable `EmbeddedRun`. This is the
 * fusion seam: any domain component (a task row now; others later) drops in
 * `<SubjectRun>` to show its execution detail in-context — no per-component
 * backend field (the link is the generic `subjectType`/`subjectId` on the
 * execution).
 *
 * Reads the fixed platform query directly (like the operator feature), not via
 * the app allowlist — that gates app-AUTHORED view bindings, whereas this is
 * platform code reading org-RLS-gated execution data.
 */
import { SkeletonText } from '@tale/ui/skeleton';
import { Text } from '@tale/ui/text';

import { EmbeddedRun } from '@/app/features/operator/components/embedded-run';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

import { useAppRuntime } from '../../runtime/app-runtime';

export function SubjectRun({
  subjectType,
  subjectId,
}: {
  subjectType: string;
  subjectId: string;
}) {
  const { t } = useT('apps');
  const { organizationId } = useAppRuntime();
  const { data, isLoading } = useConvexQuery(
    api.workflow_executions.queries.getLatestExecutionForSubject,
    { organizationId, subjectType, subjectId },
  );

  if (isLoading && data === undefined) return <SkeletonText lines={4} />;
  if (!data) return <Text variant="muted">{t('runs.none')}</Text>;
  return (
    <EmbeddedRun
      organizationId={organizationId}
      executionId={data.executionId}
    />
  );
}
