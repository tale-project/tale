'use client';

import { Badge } from '@tale/ui/badge';
import { Text } from '@tale/ui/text';
import { Link } from '@tanstack/react-router';

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
 * The automation's run log, newest first — the Runs tab's list.
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
  headingId,
}: {
  organizationId: string;
  automationSlug: string;
  runs: readonly AutomationRunSummary[];
  /** Keep run links inside the project shell. */
  projectId?: string;
  /** The id of the heading that names this list. */
  headingId: string;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();

  if (runs.length === 0) {
    return (
      <Text as="p" variant="muted" className="text-sm">
        {t('runs.empty')}
      </Text>
    );
  }

  return (
    <ul
      aria-labelledby={headingId}
      className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border"
    >
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
              {run.detail ?? t('runs.startedBy', { actor: run.startedBy })}
            </span>
            <Text as="span" variant="muted" className="text-xs">
              {formatDate(new Date(run.startedAt), 'long')}
            </Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}
