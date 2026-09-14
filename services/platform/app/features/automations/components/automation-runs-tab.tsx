'use client';

import { ContentArea } from '@tale/ui/content-area';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationRuns } from '../hooks/queries';
import { RunList } from './run-list';

/** How much of the log the tab shows — the newest runs, the ones being watched. */
const RUNS_TAB_LIMIT = 50;

/**
 * The Runs tab: the automation's run log, newest first, at the configuration
 * measure like a project's list tabs. A row opens that run's page under the
 * same chrome.
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
  const headingId = useId();
  const runsQuery = useAutomationRuns(
    organizationId,
    automationSlug,
    RUNS_TAB_LIMIT,
  );

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        as="h2"
        title={<span id={headingId}>{t('runs.title')}</span>}
        description={t('runs.description')}
      />
      <Skeletonize loading={runsQuery.isPending} label={t('runs.title')}>
        <RunList
          organizationId={organizationId}
          automationSlug={automationSlug}
          {...(projectId !== undefined && { projectId })}
          runs={runsQuery.data ?? []}
          headingId={headingId}
        />
      </Skeletonize>
    </ContentArea>
  );
}
