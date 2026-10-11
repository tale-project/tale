'use client';

import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { Tooltip } from '@tale/ui/tooltip';
import { useFormatDate } from '@tale/ui/use-format-date';
import { Link, useNavigate } from '@tanstack/react-router';
import {
  ChevronDown,
  GitCommitVertical,
  History,
  Radio,
  SquarePen,
} from 'lucide-react';
import type { ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAutomationVersions } from '../hooks/queries';
import {
  compareVersionLink,
  editorVersionLink,
  versionsTabLink,
} from '../lib/detail-paths';
import { useAuthorText } from './versions/version-author';

/** A badge is a label; the pill answers a click, so it is drawn as a
 * compact outlined chip with a hover fill and a focus ring. */
const PILL = cn(
  'border-border bg-background text-foreground inline-flex h-6 shrink-0 items-center gap-1 rounded-md border px-2 text-xs font-medium whitespace-nowrap',
  'hover:bg-accent data-[state=open]:bg-accent transition-colors duration-[var(--duration-short)] motion-reduce:transition-none',
  'focus-visible:ring-ring ring-offset-background focus-visible:ring-1 focus-visible:outline-none',
);

interface VersionPillProps {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  /** The version a run ran. */
  version: number;
  /** The live version, when known: the pill marks itself when it is it. */
  deployedVersion?: number | null | undefined;
  className?: string;
}

/** The pill's face: the version, and a green dot when it is the live one. */
function PillFace({
  version,
  live,
  trailing,
}: {
  version: number;
  live: boolean;
  trailing?: ReactNode;
}) {
  const { t } = useT('automations');
  return (
    <>
      <GitCommitVertical
        className="text-muted-foreground size-3 shrink-0"
        aria-hidden="true"
      />
      {t('versions.versionLabel', { version })}
      {live && (
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full bg-green-600 dark:bg-green-400"
        />
      )}
      {trailing}
    </>
  );
}

type VersionRow = NonNullable<
  ReturnType<typeof useAutomationVersions>['data']
>[number];

/** One version's row of the automation's version list, once loaded. */
function useVersionRow(
  organizationId: string,
  automationSlug: string,
  version: number,
): VersionRow | undefined {
  const versions = useAutomationVersions(organizationId, automationSlug);
  return versions.data?.find((each) => each.version === version);
}

/** What a pill's tooltip says about its version: its message, who saved
 * it and when. Plain text, so the tooltip's own colours keep it legible;
 * drawn only while the tooltip is open. */
function VersionFacts({
  organizationId,
  row,
}: {
  organizationId: string;
  row: VersionRow;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const author = useAuthorText(organizationId)({
    actor: row.createdBy,
    via: row.createdVia ?? null,
    viaInferred: row.viaInferred,
    clientName: row.clientName ?? null,
  });
  const saved = [
    author.name,
    author.caption,
    formatDate(new Date(row.createdAt), 'long'),
  ]
    .filter((part) => part !== null && part !== '')
    .join(' · ');
  return (
    <span className="flex max-w-72 flex-col gap-0.5">
      <span className="truncate font-medium">
        {row.message === null || row.message === ''
          ? t('versions.noMessage')
          : row.message}
      </span>
      <span>{saved}</span>
    </span>
  );
}

/**
 * A run's version as a link to that version in the editor: "v3", with a
 * green dot when it is the live one. Its tooltip names the version's
 * message, who saved it and when. Inside a row that opens its run, the
 * pill keeps its click to itself.
 */
export function AutomationVersionPill({
  organizationId,
  automationSlug,
  projectId,
  version,
  deployedVersion,
  className,
}: VersionPillProps) {
  const { t } = useT('automations');
  const live = deployedVersion === version;
  const row = useVersionRow(organizationId, automationSlug, version);
  return (
    <Tooltip
      content={
        row === undefined ? null : (
          <VersionFacts organizationId={organizationId} row={row} />
        )
      }
    >
      <Link
        {...editorVersionLink({
          organizationId,
          automationSlug,
          projectId,
          version,
        })}
        aria-label={t('runs.versionPill.name', {
          version,
          live: live ? 'true' : 'false',
        })}
        className={cn(PILL, className)}
        onClick={(event) => {
          event.stopPropagation();
        }}
      >
        <PillFace version={version} live={live} />
      </Link>
    </Tooltip>
  );
}

/**
 * The run page's version pill: a menu to open the version in the editor,
 * compare it with the live one when that is another, or read the version
 * history.
 */
export function RunVersionMenu({
  organizationId,
  automationSlug,
  projectId,
  version,
  deployedVersion,
  className,
}: VersionPillProps) {
  const { t } = useT('automations');
  const navigate = useNavigate();
  const live = deployedVersion === version;
  const row = useVersionRow(organizationId, automationSlug, version);
  const place = { organizationId, automationSlug, projectId };
  const otherLive =
    deployedVersion !== undefined &&
    deployedVersion !== null &&
    deployedVersion !== version
      ? deployedVersion
      : null;
  return (
    <DropdownMenu
      align="start"
      tooltip={
        row === undefined ? undefined : (
          <VersionFacts organizationId={organizationId} row={row} />
        )
      }
      trigger={
        <button
          type="button"
          aria-label={t('runs.versionPill.menu', {
            version,
            live: live ? 'true' : 'false',
          })}
          className={cn(PILL, className)}
        >
          <PillFace
            version={version}
            live={live}
            trailing={
              <ChevronDown
                className="text-muted-foreground size-3 shrink-0"
                aria-hidden="true"
              />
            }
          />
        </button>
      }
      items={() => [
        [
          {
            type: 'item',
            label: t('runs.versionPill.open', { version }),
            icon: SquarePen,
            onClick: () => {
              void navigate(editorVersionLink({ ...place, version }));
            },
          },
          ...(otherLive === null
            ? []
            : [
                {
                  type: 'item' as const,
                  label: t('runs.versionPill.compareWithLive', {
                    version,
                    live: otherLive,
                  }),
                  icon: Radio,
                  onClick: () => {
                    // The newer of the two is the one compared: what it
                    // changed against the older.
                    void navigate(
                      compareVersionLink({
                        ...place,
                        version: Math.max(version, otherLive),
                        from: Math.min(version, otherLive),
                      }),
                    );
                  },
                },
              ]),
          {
            type: 'item',
            label: t('versions.actions.history'),
            icon: History,
            onClick: () => {
              void navigate(versionsTabLink(place));
            },
          },
        ],
      ]}
    />
  );
}
