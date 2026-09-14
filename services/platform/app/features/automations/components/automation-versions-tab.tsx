'use client';

import { ContentArea } from '@tale/ui/content-area';
import { Skeletonize } from '@tale/ui/skeleton-context';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomation, useAutomationVersions } from '../hooks/queries';
import { VersionList } from './version-list';

/**
 * The Versions tab: the automation's immutable history at the configuration
 * measure, like a project's list tabs. Each row opens the Editor at that
 * version; which one is live is read off the automation itself so the badge
 * agrees with the Editor's.
 */
export function AutomationVersionsTab({
  organizationId,
  automationSlug,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep the rows' editor links inside the project shell. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const headingId = useId();
  const automationQuery = useAutomation(organizationId, automationSlug);
  const versionsQuery = useAutomationVersions(organizationId, automationSlug);

  return (
    <ContentArea variant="narrow" gap={6}>
      <StickySectionHeader
        as="h2"
        title={<span id={headingId}>{t('versions.title')}</span>}
        description={t('versions.description')}
      />
      <Skeletonize
        loading={versionsQuery.isPending}
        label={t('versions.title')}
      >
        <VersionList
          organizationId={organizationId}
          automationSlug={automationSlug}
          {...(projectId !== undefined && { projectId })}
          versions={versionsQuery.data ?? []}
          deployedVersion={automationQuery.data?.deployedVersion}
          headingId={headingId}
        />
      </Skeletonize>
    </ContentArea>
  );
}
