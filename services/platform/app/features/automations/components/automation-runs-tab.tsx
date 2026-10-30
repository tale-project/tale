'use client';

import { ContentArea } from '@tale/ui/content-area';
import { StickySectionHeader } from '@tale/ui/sticky-section-header';
import { useRef } from 'react';

import { useT } from '@/lib/i18n/client';

import { RunsTable } from './runs-table';

/**
 * The Runs tab: the automation's runs as a table, newest first, a page at
 * a time, narrowed by status and mode. A row opens that run's page under
 * the same chrome; two selected runs open their comparison.
 *
 * A collection screen like the Automations list: `ContentArea variant="list"`
 * bounds the tab against the shell, so the heading, the filters and the
 * table's header row stay put while the rows scroll inside the table's own
 * frame.
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
  // A failed read's retry hands its focus here once the runs arrive.
  const headingRef = useRef<HTMLSpanElement>(null);

  return (
    <ContentArea variant="list" gap={6}>
      <StickySectionHeader
        as="h2"
        title={
          <span ref={headingRef} tabIndex={-1}>
            {t('runs.title')}
          </span>
        }
        description={t('runs.description')}
      />
      <RunsTable
        organizationId={organizationId}
        automationSlug={automationSlug}
        {...(projectId !== undefined && { projectId })}
        onErrorFocusLost={() => headingRef.current?.focus()}
      />
    </ContentArea>
  );
}
