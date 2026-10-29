'use client';

import { Badge } from '@tale/ui/badge';
import { ChangeSummary } from '@tale/ui/change-list';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { ErrorDisplayCompact } from '@tale/ui/error-boundaries/error-display-compact';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { TableTimestampCell } from '@tale/ui/table-date-cell';
import {
  type TestStatus,
  TestStatusIcon,
  useTestStatusLabel,
} from '@tale/ui/test-results';
import { Text } from '@tale/ui/text';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import {
  Download,
  GitBranch,
  GitCompare,
  GitCommitVertical,
  Radio,
  Rocket,
  RotateCcw,
  SquarePen,
  Undo2,
} from 'lucide-react';
import { useMemo } from 'react';

import type { PageItemOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { useAutomationVersionHistory } from '../../hooks/queries';
import type { DeployVersion } from '../../hooks/use-deploy-version';
import { versionTestsWords } from '../../lib/automation-tests/version-tests';
import { compareVersionLink, editorVersionLink } from '../../lib/detail-paths';
import { changeFlags } from '../../lib/version-changes';
import { RowMenu } from '../row-menu';
import { VersionAuthor } from './version-author';

export type VersionHistoryRow =
  PageItemOf<'automations/queries:listVersionHistory'>;

function testStatusOf(row: VersionHistoryRow): TestStatus {
  if (row.testsPassed === true) return 'passed';
  if (row.testsPassed === false) return 'failed';
  return 'not-run';
}

/**
 * Every version of an automation, newest first, a page at a time: whether
 * it is live or when it last went live, its message and lineage (based on
 * an older version, a restore of one), who saved it and through what, what
 * it changed against the version before it, and how its tests went. A row
 * opens what it changed. Its menu compares it with the live version, opens
 * it in the editor, deploys it — or rolls back to it — in one click,
 * restores it as the newest version, or downloads it.
 */
export function VersionHistoryTable({
  organizationId,
  automationSlug,
  projectId,
  canAuthor,
  latestVersion,
  liveVersion,
  deployer,
  onRestore,
  onDownload,
  onErrorFocusLost,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  /** May deploy, roll back and restore. */
  canAuthor: boolean;
  /** The newest version; undefined until the automation's read answers,
   * and no version offers a restore meanwhile. */
  latestVersion: number | undefined;
  /** The version the page shows as live; null when none is. */
  liveVersion: number | null;
  deployer: Pick<DeployVersion, 'deploy'>;
  onRestore: (version: number) => void;
  onDownload: (version: number) => void;
  /** Takes the focus a failed read's retry held once the versions arrive. */
  onErrorFocusLost?: () => void;
}) {
  const { t } = useT('automations');
  const { formatDate } = useFormatDate();
  const testStatusLabel = useTestStatusLabel();
  const navigate = useNavigate();
  const result = useAutomationVersionHistory(organizationId, automationSlug);

  const columns = useMemo<ColumnDef<VersionHistoryRow>[]>(
    () => [
      {
        id: 'version',
        header: t('versions.columns.version'),
        size: 170,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col items-start gap-1">
            <span className="text-sm font-medium tabular-nums">
              {t('versions.versionLabel', { version: row.original.version })}
            </span>
            {row.original.deployed ? (
              <Badge variant="green" icon={Radio}>
                {t('versions.deployed')}
              </Badge>
            ) : (
              row.original.lastDeployedAt !== null && (
                <Text as="span" variant="caption">
                  {t('versions.lastLive', {
                    date: formatDate(
                      new Date(row.original.lastDeployedAt),
                      'medium',
                    ),
                  })}
                </Text>
              )
            )}
          </span>
        ),
      },
      {
        id: 'message',
        header: t('versions.columns.message'),
        size: 280,
        cell: ({ row }) => {
          const { version, basedOnVersion, restoredFromVersion } = row.original;
          // A version saved without a message keeps an empty one.
          const message =
            row.original.message === null || row.original.message.trim() === ''
              ? null
              : row.original.message;
          // A version saved on top of the one before it needs no word; one
          // built on an older version, or restoring one, says which.
          const branched =
            restoredFromVersion === null &&
            basedOnVersion !== null &&
            basedOnVersion !== version - 1;
          return (
            <span className="flex min-w-0 flex-col items-start gap-1">
              {message === null ? (
                <Text as="span" variant="muted" truncate>
                  {t('versions.noMessage')}
                </Text>
              ) : (
                // Capped at the cell, so a long message is cut, not spilled
                // into the next column.
                <Text
                  as="span"
                  truncate
                  title={message}
                  className="block max-w-full"
                >
                  {message}
                </Text>
              )}
              {restoredFromVersion !== null && (
                <Badge variant="slate" icon={RotateCcw}>
                  {t('versions.restores', { version: restoredFromVersion })}
                </Badge>
              )}
              {branched && (
                <Badge variant="slate" icon={GitBranch}>
                  {t('versions.basedOn', { version: basedOnVersion })}
                </Badge>
              )}
            </span>
          );
        },
      },
      {
        id: 'savedBy',
        header: t('versions.columns.savedBy'),
        size: 200,
        cell: ({ row }) => (
          <VersionAuthor
            organizationId={organizationId}
            facts={{
              actor: row.original.createdBy,
              via: row.original.createdVia,
              viaInferred: row.original.viaInferred,
              clientName: row.original.clientName,
            }}
          />
        ),
      },
      {
        id: 'saved',
        header: t('versions.columns.saved'),
        size: 210,
        cell: ({ row }) => (
          <TableTimestampCell
            timestamp={row.original.createdAt}
            preset="long"
            alignRight={false}
          />
        ),
      },
      {
        id: 'changes',
        header: t('versions.columns.changes'),
        size: 220,
        cell: ({ row }) => {
          const changes = row.original.changes;
          if (changes === null) {
            return (
              <Text as="span" variant="caption">
                {t('versions.changesNotKept')}
              </Text>
            );
          }
          if (changes.first === true) {
            return (
              <Text as="span" variant="caption">
                {t('versions.firstVersion')}
              </Text>
            );
          }
          return (
            <ChangeSummary
              counts={{
                added: changes.nodes.added,
                removed: changes.nodes.removed,
                changed: changes.nodes.changed,
                renamed: changes.nodes.renamed ?? 0,
              }}
              flags={changeFlags(changes, t)}
            />
          );
        },
      },
      {
        id: 'tests',
        header: t('versions.columns.tests'),
        size: 190,
        cell: ({ row }) => {
          const status = testStatusOf(row.original);
          const words = versionTestsWords(row.original, {
            t,
            formatDate: (date) => formatDate(date, 'long'),
            verdict: (passed) => testStatusLabel(passed ? 'passed' : 'failed'),
          });
          return (
            <span className="flex flex-col gap-0.5 text-sm">
              <span className="flex items-center gap-1.5">
                <TestStatusIcon status={status} />
                {/* No verdict was kept: the version may have no tests at
                    all, so it is no promise that they will run. */}
                {words === null ? t('versions.testsNone') : words.summary}
              </span>
              {words?.checked !== undefined && (
                // Balanced, so a narrow column breaks after the act rather
                // than inside the date.
                <span className="text-muted-foreground text-xs text-balance">
                  {words.checked}
                </span>
              )}
            </span>
          );
        },
      },
      {
        id: 'actions',
        header: '',
        size: ACTIONS_COLUMN_SIZE,
        enableSorting: false,
        meta: { isAction: true },
        cell: ({ row }) => {
          const { version, deployed } = row.original;
          const back = liveVersion !== null && version < liveVersion;
          return (
            <RowMenu
              label={t('versions.actions.menu', { version })}
              actions={(button) => [
                {
                  key: 'changes',
                  label: t('versions.actions.whatChanged'),
                  icon: GitCompare,
                  onClick: () =>
                    void navigate(
                      compareVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version,
                      }),
                    ),
                },
                {
                  key: 'compareLive',
                  label: t('versions.actions.compareWithLive'),
                  icon: Radio,
                  visible: liveVersion !== null && !deployed,
                  onClick: () =>
                    void navigate(
                      compareVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version,
                        from: liveVersion ?? undefined,
                      }),
                    ),
                },
                {
                  key: 'open',
                  label: t('versions.actions.openInEditor'),
                  icon: SquarePen,
                  onClick: () =>
                    void navigate(
                      editorVersionLink({
                        organizationId,
                        automationSlug,
                        projectId,
                        version,
                      }),
                    ),
                },
                {
                  key: 'deploy',
                  label: back
                    ? t('deploy.rollBack', { version })
                    : t('detail.deployVersion', { version }),
                  icon: back ? Undo2 : Rocket,
                  visible: canAuthor && !deployed,
                  // Never disabled while a deploy runs: the item keeps the
                  // focus the menu hands back to its button, and the
                  // deploy starts one at a time on its own.
                  onClick: () => deployer.deploy(version, liveVersion, button),
                },
                {
                  key: 'restore',
                  label: t('versions.actions.restore'),
                  icon: RotateCcw,
                  // A restore saves on top of the latest version, so it waits
                  // until the automation's read has named it.
                  visible:
                    canAuthor &&
                    latestVersion !== undefined &&
                    version !== latestVersion,
                  onClick: () => onRestore(version),
                },
                {
                  key: 'download',
                  label: t('versions.actions.downloadYaml'),
                  icon: Download,
                  separator: true,
                  onClick: () => onDownload(version),
                },
              ]}
            />
          );
        },
      },
    ],
    [
      t,
      formatDate,
      testStatusLabel,
      navigate,
      organizationId,
      automationSlug,
      projectId,
      canAuthor,
      latestVersion,
      liveVersion,
      deployer,
      onRestore,
      onDownload,
    ],
  );

  const hasMore =
    result.status === 'CanLoadMore' || result.status === 'LoadingMore';
  // A read that failed is never an empty history: with no versions yet the
  // failure stands in for the table; with versions on screen the table keeps
  // them and the failure sits under it.
  const failure =
    result.error === null ? null : (
      <div role="alert">
        <ErrorDisplayCompact
          error={result.error}
          organizationId={organizationId}
          reset={result.retry}
          {...(onErrorFocusLost !== undefined && {
            onFocusLost: onErrorFocusLost,
          })}
        />
      </div>
    );

  if (failure !== null && result.results.length === 0) return failure;
  return (
    <>
      <DataTable<VersionHistoryRow>
        columns={columns}
        data={result.results}
        caption={t('versions.caption')}
        isLoading={result.status === 'LoadingFirstPage'}
        {...(result.status !== 'LoadingFirstPage' && {
          approxRowCount: result.results.length,
        })}
        getRowId={(row) => String(row.version)}
        clickableRows
        onRowClick={(row) => {
          void navigate(
            compareVersionLink({
              organizationId,
              automationSlug,
              projectId,
              version: row.original.version,
            }),
          );
        }}
        infiniteScroll={{
          hasMore,
          onLoadMore: () => result.loadMore(DEFAULT_LIST_PAGE_SIZE),
          isLoadingMore: result.status === 'LoadingMore',
          isInitialLoading: result.status === 'LoadingFirstPage',
          loadFailed: failure !== null,
          entityLabel: {
            one: t('versions.entity.one'),
            other: t('versions.entity.other'),
          },
        }}
        emptyState={{
          icon: GitCommitVertical,
          title: t('versions.empty'),
        }}
      />
      {failure}
    </>
  );
}
