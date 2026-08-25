'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { SectionHeader } from '@tale/ui/section-header';
import { Text } from '@tale/ui/text';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useId } from 'react';

import { CappedScrollRegion } from '@/app/components/ui/data-display/capped-scroll-region';
import { useFormatDate } from '@/app/hooks/use-format-date';
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
 * The automation's version history.
 *
 * Versions are immutable, so this list is a real history rather than a log of
 * edits: every entry is a document that can still be read and run. Exactly one
 * is live at a time and it is marked as such. Promoting a version is a
 * separate control next to the looking/live badges — this list only switches
 * which document the canvas shows.
 */
export function VersionList({
  versions,
  deployedVersion,
  selectedVersion,
  onSelectVersion,
}: {
  versions: readonly AutomationVersionSummary[];
  deployedVersion: number | undefined;
  selectedVersion: number | undefined;
  onSelectVersion: (version: number) => void;
}) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const { formatDate } = useFormatDate();
  const headingId = useId();

  const ordered = [...versions].sort((a, b) => b.version - a.version);

  return (
    <section aria-labelledby={headingId} className="flex flex-col gap-3">
      <SectionHeader
        as="h3"
        size="sm"
        title={<span id={headingId}>{t('versions.title')}</span>}
      />

      {ordered.length === 0 ? (
        <Text as="p" variant="muted" className="text-sm">
          {t('versions.empty')}
        </Text>
      ) : (
        <CappedScrollRegion
          className="border-border bg-card overflow-hidden rounded-lg border"
          fadeFromClassName="from-card"
          maxHeightClassName="max-h-72"
          scrollLabel={tCommon('aria.scrollDown')}
        >
          <ul className="divide-border divide-y">
            {ordered.map((entry) => {
              const isDeployed = entry.version === deployedVersion;
              const isSelected = entry.version === selectedVersion;
              return (
                <li
                  key={entry.version}
                  className="flex flex-wrap items-center gap-2 px-3 py-2.5"
                >
                  <Button
                    variant="ghost"
                    size="sm"
                    aria-current={isSelected ? 'true' : undefined}
                    onClick={() => {
                      onSelectVersion(entry.version);
                    }}
                  >
                    {t('versions.versionLabel', { version: entry.version })}
                  </Button>
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
                  <span className="min-w-0 flex-1 truncate text-sm">
                    {entry.message ?? t('versions.noMessage')}
                  </span>
                  <Text as="span" variant="muted" className="text-xs">
                    {formatDate(new Date(entry.createdAt), 'long')}
                  </Text>
                </li>
              );
            })}
          </ul>
        </CappedScrollRegion>
      )}
    </section>
  );
}
