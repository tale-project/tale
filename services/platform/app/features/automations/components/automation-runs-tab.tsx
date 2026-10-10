'use client';

import { ContentArea } from '@tale/ui/content-area';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';

import { useT } from '@/lib/i18n/client';

import { RunsTable } from './runs-table';

/**
 * The Runs tab: the automation's runs as a table, newest first, a page at
 * a time, narrowed by status and mode. A row opens that run's page under
 * the same chrome; two selected runs open their comparison.
 */
export function AutomationRunsTab({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep the run links inside the project shell. */
  projectId?: string;
}) {
  const { t } = useT('automations');

  return (
    <ContentArea gap={6}>
      <StickySectionHeader
        as="h2"
        title={t('runs.title')}
        description={t('runs.description')}
      />
      <RunsTable
        organizationId={organizationId}
        automationSlug={automationSlug}
        {...(projectId !== undefined && { projectId })}
      />
    </ContentArea>
  );
}
