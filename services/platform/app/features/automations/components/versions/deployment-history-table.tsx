'use client';

import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { ErrorDisplayCompact } from '@tale/ui/error-boundaries/error-display-compact';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { TableTimestampCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef } from '@tanstack/react-table';
import { History, Rocket, SquarePen, Undo2 } from 'lucide-react';
import { useMemo } from 'react';

import type { PageItemOf } from '@/app/lib/backend/contract';
import { useT } from '@/lib/i18n/client';

import { useAutomationDeployments } from '../../hooks/queries';
import type { DeployVersion } from '../../hooks/use-deploy-version';
import { editorVersionLink } from '../../lib/detail-paths';
import { VersionAuthor } from './version-author';
import { VersionRowMenu } from './version-row-menu';

type DeploymentRow = PageItemOf<'automations/queries:listDeploymentsPaginated'>;

const KIND_ICON = { deploy: Rocket, rollback: Undo2, recorded: History };

const KIND_KEY = {
  deploy: 'deployments.kind.deploy',
  rollback: 'deployments.kind.rollback',
  recorded: 'deployments.kind.recorded',
} as const;

/**
 * Every time a version of the automation went live, newest first, a page at
 * a time: when, which version and whether it rolled back to an older one,
 * what it replaced, and who put it live through what. A version found live
 * before the history was kept reads as such. A row's menu puts its version
 * live again in one click, or opens it in the editor.
 */
export function DeploymentHistoryTable({
  organizationId,
  automationSlug,
  projectId,
  canAuthor,
  liveVersion,
  deployer,
  onErrorFocusLost,
}: {
  organizationId: string;
  automationSlug: string;
  projectId?: string | undefined;
  canAuthor: boolean;
  /** The version the page shows as live; null when none is. */
  liveVersion: number | null;
  deployer: Pick<DeployVersion, 'deploy'>;
  onErrorFocusLost?: () => void;
}) {
  const { t } = useT('automations');
  const navigate = useNavigate();
  const result = useAutomationDeployments(organizationId, automationSlug);

  const columns = useMemo<ColumnDef<DeploymentRow>[]>(
    () => [
      {
        id: 'when',
        header: t('deployments.columns.when'),
        size: 180,
        cell: ({ row }) => (
          <TableTimestampCell
            timestamp={row.original.deployedAt}
            preset="long"
            alignRight={false}
          />
        ),
      },
      {
        id: 'what',
        header: t('deployments.columns.what'),
        size: 240,
        cell: ({ row }) => {
          const { kind, version, synthesized } = row.original;
          const Icon = KIND_ICON[kind];
          return (
            <span className="flex min-w-0 items-start gap-2">
              <Icon
                aria-hidden="true"
                className="text-muted-foreground mt-0.5 size-4 shrink-0"
              />
              <span className="flex min-w-0 flex-col">
                <Text as="span" truncate>
                  {t(KIND_KEY[kind], { version })}
                </Text>
                {(kind === 'recorded' || synthesized) && (
                  <Text as="span" variant="caption">
                    {t('deployments.recordedHint')}
                  </Text>
                )}
              </span>
            </span>
          );
        },
      },
      {
        id: 'replaced',
        header: t('deployments.columns.replaced'),
        size: 110,
        cell: ({ row }) =>
          row.original.previousVersion === null ? (
            <span className="text-muted-foreground">—</span>
          ) : (
            <span className="tabular-nums">
              {t('versions.versionLabel', {
                version: row.original.previousVersion,
              })}
            </span>
          ),
      },
      {
        id: 'by',
        header: t('deployments.columns.by'),
        size: 220,
        cell: ({ row }) => (
          <VersionAuthor
            organizationId={organizationId}
            facts={{
              actor: row.original.deployedBy,
              via: row.original.via,
              clientName: row.original.clientName,
            }}
          />
        ),
      },
      {
        id: 'actions',
        header: '',
        size: ACTIONS_COLUMN_SIZE,
        enableSorting: false,
        meta: { isAction: true },
        cell: ({ row }) => {
          const { version } = row.original;
          const back = liveVersion !== null && version < liveVersion;
          return (
            <VersionRowMenu
              label={t('deployments.actions.menu', { version })}
              actions={(button) => [
                {
                  key: 'deploy',
                  label: back
                    ? t('deploy.rollBack', { version })
                    : t('detail.deployVersion', { version }),
                  icon: back ? Undo2 : Rocket,
                  visible: canAuthor && version !== liveVersion,
                  // Never disabled while a deploy runs: the item keeps the
                  // focus the menu hands back to its button, and the deploy
                  // starts one at a time on its own.
                  onClick: () => deployer.deploy(version, liveVersion, button),
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
              ]}
            />
          );
        },
      },
    ],
    [
      t,
      navigate,
      organizationId,
      automationSlug,
      projectId,
      canAuthor,
      liveVersion,
      deployer,
    ],
  );

  const hasMore =
    result.status === 'CanLoadMore' || result.status === 'LoadingMore';
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
      <DataTable<DeploymentRow>
        columns={columns}
        data={result.results}
        caption={t('deployments.caption')}
        isLoading={result.status === 'LoadingFirstPage'}
        {...(result.status !== 'LoadingFirstPage' && {
          approxRowCount: result.results.length,
        })}
        getRowId={(row) =>
          row.id ?? `${String(row.deployedAt)}:${String(row.version)}`
        }
        clickableRows
        onRowClick={(row) => {
          void navigate(
            editorVersionLink({
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
            one: t('deployments.entity.one'),
            other: t('deployments.entity.other'),
          },
        }}
        emptyState={{ icon: Rocket, title: t('deployments.empty') }}
      />
      {failure}
    </>
  );
}
