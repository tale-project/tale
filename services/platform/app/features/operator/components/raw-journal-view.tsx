'use client';

/** The raw view: the unprojected, reactive per-step state + execution facts as
 * JSON — the operator's escape hatch when the friendly projection isn't enough.
 * Reads the same safe (string-arg) status payload the projection is built from. */
import { Text } from '@tale/ui/text';

import { JsonViewer } from '@/app/components/ui/data-display/json-viewer';
import { useConvexQuery } from '@/app/hooks/use-convex-query';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';

export function RawJournalView({ executionId }: { executionId: string }) {
  const { t } = useT('operator');
  const statuses = useConvexQuery(
    api.workflow_executions.queries.getExecutionStepStatuses,
    { executionId },
  );

  if (statuses.data === null || statuses.data === undefined) {
    return <Text variant="muted">{t('body.noJournal')}</Text>;
  }

  return <JsonViewer data={statuses.data} collapsed={2} enableClipboard />;
}
