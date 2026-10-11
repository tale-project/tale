'use client';

import { Badge } from '@tale/ui/badge';
import { EmptyState } from '@tale/ui/empty-state';
import { RadioGroup, RadioGroupItem } from '@tale/ui/radio-group';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  CheckCircle2,
  GitBranch,
  GitCommitVertical,
  Radio,
  RotateCcw,
  XCircle,
} from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';
import type { AutomationWriteVia } from '@/lib/shared/schemas/automation-versions';

import {
  versionTestsWords,
  type VersionTests,
} from '../lib/automation-tests/version-tests';
import { editorVersionLink, versionsTabLink } from '../lib/detail-paths';
import { VersionAuthor } from './versions/version-author';

/** One row of the immutable version history, as the store reports it:
 * who saved it, through which door and client, and what it was built from
 * — fields a server older than them leaves out. */
export interface AutomationVersionSummary {
  version: number;
  message: string | null;
  testsPassed: boolean | null;
  /** When its tests were last checked, and how many passed of how many. */
  testsCheckedAt?: number | null;
  tests?: VersionTests['tests'];
  createdBy: string;
  createdAt: number;
  createdVia?: AutomationWriteVia | null;
  viaInferred?: boolean;
  clientName?: string | null;
  basedOnVersion?: number | null;
  restoredFromVersion?: number | null;
}

/**
 * The automation's version history, shared by its version picker.
 *
 * Versions are immutable, so this list is a real history rather than a log of
 * edits: every entry is a document that can still be read and run. Exactly one
 * is live at a time and it is marked as such. Each row says who saved it and
 * how, and what it restores or was built from. A row opens the Editor at
 * that version; promoting one is the editor's Deploy control, never a row
 * action. The whole history — deployments, comparisons — is a link away.
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

  const selectVersion = (version: number) => {
    if (onSelectVersion) {
      onSelectVersion(version);
      return;
    }
    void navigate(
      editorVersionLink({
        organizationId,
        automationSlug,
        projectId: projectId || undefined,
        version,
      }),
    );
  };
  return (
    <>
      <RadioGroup
        aria-labelledby={headingId}
        value={currentVersion?.toString() ?? ''}
        orientation="vertical"
        className="gap-1"
        onValueChange={(value) => selectVersion(Number(value))}
      >
        {ordered.map((entry) => {
          const isDeployed = entry.version === deployedVersion;
          // How its tests went: how many passed, and how and when checked.
          const words = versionTestsWords(entry, {
            t,
            formatDate: (date) => formatDate(date, 'long'),
            verdict: (passed) =>
              t(passed ? 'versions.testsPassed' : 'versions.testsFailed'),
          });
          const testWords =
            words === null
              ? null
              : words.checked === undefined
                ? words.summary
                : `${words.summary} · ${words.checked}`;
          // A version saved without a message keeps an empty one.
          const message =
            entry.message === null || entry.message.trim() === ''
              ? t('versions.noMessage')
              : entry.message;
          // A version saved on top of the one before needs no word; one built
          // on an older version, or restoring one, says which.
          const restored = entry.restoredFromVersion ?? null;
          const branched =
            restored === null &&
            entry.basedOnVersion !== undefined &&
            entry.basedOnVersion !== null &&
            entry.basedOnVersion !== entry.version - 1;
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
                    title={message}
                  >
                    {message}
                  </span>
                  {/* The lineage sits at the end of the title line, so the
                    row keeps its two lines; a long message gives way. */}
                  {restored !== null && (
                    <Badge
                      variant="slate"
                      icon={RotateCcw}
                      className="shrink-0 self-center py-0.5"
                    >
                      {t('versions.restores', { version: restored })}
                    </Badge>
                  )}
                  {branched && (
                    <Badge
                      variant="slate"
                      icon={GitBranch}
                      className="shrink-0 self-center py-0.5"
                    >
                      {t('versions.basedOn', {
                        version: entry.basedOnVersion,
                      })}
                    </Badge>
                  )}
                </span>
                <span className="flex w-full min-w-0 items-center gap-2">
                  {/* Who saved it and how, then when: one line, cut at its
                    end when long, so a row stays two lines tall. */}
                  <Text
                    as="span"
                    variant="caption"
                    className="min-w-0 truncate"
                  >
                    <VersionAuthor
                      organizationId={organizationId}
                      layout="inline"
                      facts={{
                        actor: entry.createdBy,
                        via: entry.createdVia ?? null,
                        viaInferred: entry.viaInferred === true,
                        clientName: entry.clientName ?? null,
                      }}
                    />
                    <span aria-hidden="true">{' · '}</span>
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
                  {testWords !== null && (
                    <Tooltip content={testWords}>
                      <span
                        role="img"
                        aria-label={testWords}
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
      <Link
        {...versionsTabLink({
          organizationId,
          automationSlug,
          projectId: projectId || undefined,
        })}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring mt-1 block rounded-md px-3 py-2 text-sm underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none"
      >
        {t('versions.actions.allVersions')}
      </Link>
    </>
  );
}
