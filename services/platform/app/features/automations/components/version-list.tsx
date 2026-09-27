'use client';

import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link } from '@tanstack/react-router';
import { CheckCircle2, GitCommitVertical, XCircle } from 'lucide-react';

import { automationSlugToParam } from '@/lib/automations/slug';
import { useT } from '@/lib/i18n/client';

/** One row of the immutable version history, as the store reports it. */
export interface AutomationVersionSummary {
  version: number;
  message?: string;
  testsPassed?: boolean;
  createdBy: string;
  createdAt: number;
}

/**
 * The automation's version history — the Versions tab's list.
 *
 * Versions are immutable, so this list is a real history rather than a log of
 * edits: every entry is a document that can still be read and run. Exactly one
 * is live at a time and it is marked as such. A row opens the Editor at that
 * version; promoting one is the editor's Deploy control, never a row action.
 */
export function VersionList({
  organizationId,
  automationSlug,
  projectId,
  versions,
  deployedVersion,
  headingId,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep the editor links inside the project shell. */
  projectId?: string;
  versions: readonly AutomationVersionSummary[];
  deployedVersion: number | undefined;
  /** The id of the heading that names this list. */
  headingId: string;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();

  const ordered = [...versions].sort((a, b) => b.version - a.version);
  if (ordered.length === 0) {
    return (
      <EmptyState
        icon={GitCommitVertical}
        title={t('versions.empty')}
        className="rounded-lg border border-dashed py-8"
      />
    );
  }

  const slugParam = automationSlugToParam(automationSlug);
  return (
    <ul
      aria-labelledby={headingId}
      className="border-border bg-card divide-border divide-y overflow-hidden rounded-lg border"
    >
      {ordered.map((entry) => {
        const isDeployed = entry.version === deployedVersion;
        return (
          <li key={entry.version}>
            <Link
              {...(projectId
                ? {
                    to: '/dashboard/$id/projects/$projectId/automations/$automationSlug/editor' as const,
                    params: {
                      id: organizationId,
                      projectId,
                      automationSlug: slugParam,
                    },
                  }
                : {
                    to: '/dashboard/$id/automations/$automationSlug/editor' as const,
                    params: { id: organizationId, automationSlug: slugParam },
                  })}
              search={{ version: entry.version }}
              className="hover:bg-muted/50 focus-visible:bg-muted/50 flex flex-wrap items-center gap-2 px-3 py-2.5 focus-visible:outline-none"
            >
              <span className="text-sm font-medium">
                {t('versions.versionLabel', { version: entry.version })}
              </span>
              {isDeployed && (
                <Badge variant="green" icon={CheckCircle2}>
                  {t('versions.deployed')}
                </Badge>
              )}
              {entry.testsPassed === false && (
                <Badge variant="destructive" icon={XCircle}>
                  {t('versions.testsFailed')}
                </Badge>
              )}
              {entry.testsPassed === true && (
                <Badge variant="green">{t('versions.testsPassed')}</Badge>
              )}
              {/* A 10rem basis, not zero: when the message would get less,
                  the date wraps to its own line (right-aligned) instead of
                  squeezing the message to a few letters on a phone. */}
              <span className="min-w-0 flex-1 basis-40 truncate text-sm">
                {entry.message ?? t('versions.noMessage')}
              </span>
              <Text as="span" variant="muted" className="ml-auto text-xs">
                {formatDate(new Date(entry.createdAt), 'long')}
              </Text>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
