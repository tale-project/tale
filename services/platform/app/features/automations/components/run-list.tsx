'use client';

import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { History } from 'lucide-react';

import type { RunWaitingFor } from '@/app/lib/backend/contract/automations';
import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

import { useRunStarterLabel } from '../hooks/use-run-starter-label';
import { isRunFailureCode, runFailureText } from '../lib/run-failure';
import { readRunStatus, runReasonKey } from '../lib/run-view';
import { RunBadge } from './run-status-badge';

/** One run as the listing reports it. */
export interface AutomationRunSummary {
  id: string;
  name: string;
  version: number;
  status: string;
  mode: string;
  startedBy: string;
  startedVia?: 'schedule' | 'webhook' | 'event';
  waitingFor?: RunWaitingFor;
  /** A running run waiting for a server to take it over. */
  stalled?: boolean;
  detail?: string;
  /** Why a failed run failed, as a stable code. */
  failureCode?: string;
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
  const { t: tRuns } = useT('automationRuns');
  const { formatDate } = useFormatDate();
  const starterLabel = useRunStarterLabel(organizationId);

  // A failed run's sentence or a waiting run's park, in words; every other
  // row names its starter — a person, "you", an API key or the trigger kind,
  // never the `user:<id>` / `trigger:<id>` door the record carries.
  const rowText = (run: AutomationRunSummary): string => {
    const reason = runReasonKey(run);
    if (reason === undefined) return starterLabel(run);
    if (reason.kind !== 'failed') return t(reason.key, reason.values);
    // A failure the run named reads in the reader's words; an older run's
    // only account of it is the engine's sentence.
    return isRunFailureCode(run.failureCode)
      ? runFailureText(run.failureCode, { t: tRuns }).title
      : reason.detail;
  };

  if (runs.length === 0) {
    // The same dashed empty card every other list on a detail page shows,
    // not a stray line of body text under the heading.
    return (
      <EmptyState
        icon={History}
        title={t('runs.empty')}
        className="rounded-lg border border-dashed py-8"
      />
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
            <RunBadge
              status={readRunStatus(run.status)}
              stalled={run.stalled === true}
            />
            <Badge variant={run.mode === 'live' ? 'orange' : 'slate'}>
              {t(`runs.mode.${run.mode === 'live' ? 'live' : 'mock'}`)}
            </Badge>
            <span className="text-sm">
              {t('versions.versionLabel', { version: run.version })}
            </span>
            {/* A 10rem basis, as in the version list: on a phone the date
                wraps to its own line instead of squeezing the detail out. */}
            <span className="min-w-0 flex-1 basis-40 truncate text-sm">
              {rowText(run)}
            </span>
            <Text as="span" variant="muted" className="ml-auto text-xs">
              {formatDate(new Date(run.startedAt), 'long')}
            </Text>
          </Link>
        </li>
      ))}
    </ul>
  );
}
