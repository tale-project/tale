'use client';

import { Badge } from '@tale/ui/badge';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';
import { useId } from 'react';

import { CappedScrollRegion } from '@/app/components/ui/data-display/capped-scroll-region';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { readRunStatus } from '../lib/run-view';
import { RunBadge } from './run-status-badge';

/** One run as the listing reports it. */
export interface AutomationRunSummary {
  id: string;
  name: string;
  version: number;
  status: string;
  mode: string;
  startedBy: string;
  detail?: string;
  startedAt: number;
  finishedAt?: number;
}

/**
 * The automation's run log, newest first.
 *
 * Mode is on every row and never implied: a `mock` run reaches nothing outside
 * the process, a `live` one may have sent mail on the organization's behalf, and
 * confusing the two is the single most expensive mistake this list can invite.
 */
export function RunList({
  organizationId,
  automationSlug,
  runs,
  projectId,
}: {
  organizationId: string;
  automationSlug: string;
  runs: readonly AutomationRunSummary[];
  /** Keep run links inside the project shell. */
  projectId?: string;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeader
        as="h3"
        size="sm"
        title={<span id={headingId}>{t('runs.title')}</span>}
      />
      {runs.length === 0 ? (
        <Text as="p" variant="muted" className="text-sm">
          {t('runs.empty')}
        </Text>
      ) : (
        <CappedScrollRegion
          className="border-border bg-card overflow-hidden rounded-lg border"
          fadeFromClassName="from-card"
          maxHeightClassName="max-h-72"
          scrollLabel={tCommon('aria.scrollDown')}
        >
          <ul className="divide-border divide-y">
            {runs.map((run) => (
              <li key={run.id}>
                <Link
                  {...(projectId
                    ? {
                        to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/runs/$runId' as const,
                        params: {
                          id: organizationId,
                          projectId,
                          automationSlug: automationSlugToParam(automationSlug),
                          runId: run.id,
                        },
                      }
                    : {
                        to: '/dashboard/$id/automations/$automationSlug/runs/$runId' as const,
                        params: {
                          id: organizationId,
                          automationSlug: automationSlugToParam(automationSlug),
                          runId: run.id,
                        },
                      })}
                  className="hover:bg-muted/50 focus-visible:bg-muted/50 flex flex-wrap items-center gap-2 px-3 py-2.5 focus-visible:outline-none"
                >
                  <RunBadge status={readRunStatus(run.status)} />
                  <Badge variant={run.mode === 'live' ? 'orange' : 'slate'}>
                    {t(`runs.mode.${run.mode === 'live' ? 'live' : 'mock'}`)}
                  </Badge>
                  <span className="text-sm">
                    {t('versions.versionLabel', { version: run.version })}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {run.detail ??
                      t('runs.startedBy', { actor: run.startedBy })}
                  </span>
                  <Text as="span" variant="muted" className="text-xs">
                    {formatDate(new Date(run.startedAt), 'long')}
                  </Text>
                </Link>
              </li>
            ))}
          </ul>
        </CappedScrollRegion>
      )}
    </section>
  );
}
