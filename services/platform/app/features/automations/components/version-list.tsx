'use client';

import { EmptyState } from '@tale/ui/empty-state';
import { RadioGroup, RadioGroupItem } from '@tale/ui/radio-group';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNavigate } from '@tanstack/react-router';
import { CheckCircle2, GitCommitVertical, Radio, XCircle } from 'lucide-react';
import { useId } from 'react';

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
 * The automation's version history, shared by its version picker.
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
  currentVersion,
  onSelectVersion,
}: {
  organizationId: string;
  automationSlug: string;
  /** Keep the editor links inside the project shell. */
  projectId?: string;
  versions: readonly AutomationVersionSummary[];
  deployedVersion: number | undefined;
  /** The id of the heading that names this list. */
  headingId: string;
  currentVersion?: number;
  onSelectVersion?: (version: number) => void;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const navigate = useNavigate();
  const groupId = useId();

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
  const selectVersion = (version: number) => {
    if (onSelectVersion) {
      onSelectVersion(version);
      return;
    }
    void navigate({
      ...(projectId
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
          }),
      search: { version },
    });
  };
  return (
    <RadioGroup
      aria-labelledby={headingId}
      value={currentVersion?.toString() ?? ''}
      orientation="vertical"
      className="gap-1"
      onValueChange={(value) => selectVersion(Number(value))}
    >
      {ordered.map((entry) => {
        const isDeployed = entry.version === deployedVersion;
        return (
          <label
            key={entry.version}
            htmlFor={`${groupId}-${entry.version}`}
            data-current={entry.version === currentVersion}
            className="hover:bg-muted/50 data-[current=true]:bg-muted flex min-w-0 cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-left transition-colors"
          >
            <RadioGroupItem
              id={`${groupId}-${entry.version}`}
              value={String(entry.version)}
              onClick={() => {
                if (entry.version === currentVersion)
                  selectVersion(entry.version);
              }}
            />
            <span className="flex min-w-0 flex-1 flex-col gap-1">
              <span className="flex w-full min-w-0 items-baseline gap-2">
                <span className="text-muted-foreground shrink-0 text-xs font-medium tabular-nums">
                  {t('versions.versionLabel', { version: entry.version })}
                </span>
                <span
                  className="min-w-0 truncate text-sm font-medium"
                  title={entry.message ?? t('versions.noMessage')}
                >
                  {entry.message ?? t('versions.noMessage')}
                </span>
              </span>
              <span className="flex w-full min-w-0 items-center gap-2">
                <Text as="span" variant="caption" className="min-w-0 truncate">
                  {formatDate(new Date(entry.createdAt), 'long')}
                </Text>
                {isDeployed && (
                  <Tooltip content={t('versions.deployed')}>
                    <span
                      role="img"
                      aria-label={t('versions.deployed')}
                      className="shrink-0 text-green-800 dark:text-green-300"
                    >
                      <Radio aria-hidden className="size-3.5" />
                    </span>
                  </Tooltip>
                )}
                {entry.testsPassed !== undefined && (
                  <Tooltip
                    content={t(
                      entry.testsPassed
                        ? 'versions.testsPassed'
                        : 'versions.testsFailed',
                    )}
                  >
                    <span
                      role="img"
                      aria-label={t(
                        entry.testsPassed
                          ? 'versions.testsPassed'
                          : 'versions.testsFailed',
                      )}
                      className={
                        entry.testsPassed
                          ? 'shrink-0 text-green-800 dark:text-green-300'
                          : 'shrink-0 text-red-800 dark:text-red-300'
                      }
                    >
                      {entry.testsPassed ? (
                        <CheckCircle2 aria-hidden className="size-3.5" />
                      ) : (
                        <XCircle aria-hidden className="size-3.5" />
                      )}
                    </span>
                  </Tooltip>
                )}
              </span>
            </span>
          </label>
        );
      })}
    </RadioGroup>
  );
}
