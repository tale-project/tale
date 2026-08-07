'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { ProgressBar } from '@tale/ui/progress-bar';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row, RowSelectionState } from '@tanstack/react-table';
import { Folder, Globe, Plus, Users } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useDeleteProject } from '../hooks/mutations';
import { useProjectsOverview, type ProjectOverviewRow } from '../hooks/queries';
import { ProjectAvatar } from './project-avatar';
import { ProjectCreateDialog } from './project-create-dialog';
import { ProjectRowActions } from './project-row-actions';

/**
 * A plain count cell: an em-dash at zero so an empty project reads as empty
 * rather than as a stack of noisy zeros, and a `{n}+` form when the query's
 * scan hit its cap and the number is a lower bound.
 */
function CountCell({
  count,
  label,
  truncated = false,
  truncatedLabel,
}: {
  count: number;
  label: string;
  truncated?: boolean;
  truncatedLabel?: string;
}) {
  if (count === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span className="text-xs tabular-nums">
      <span aria-hidden>
        {truncated && truncatedLabel ? truncatedLabel : count}
      </span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface ProjectsTableProps {
  organizationId: string;
}

function formatRelative(timestamp: number, locale: string): string {
  const diffMs = Date.now() - timestamp;
  const diffSec = Math.round(diffMs / 1000);
  const diffMin = Math.round(diffSec / 60);
  const diffHr = Math.round(diffMin / 60);
  const diffDay = Math.round(diffHr / 24);

  const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (diffSec < 60) return rtf.format(-diffSec, 'second');
  if (diffMin < 60) return rtf.format(-diffMin, 'minute');
  if (diffHr < 24) return rtf.format(-diffHr, 'hour');
  return rtf.format(-diffDay, 'day');
}

export function ProjectsTable({ organizationId }: ProjectsTableProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { projects, isLoading, overdueTruncated, filesTruncated } =
    useProjectsOverview(organizationId, { includeArchived });
  const { mutateAsync: deleteProject } = useDeleteProject();

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleArchivedFilterChange = useCallback((values: string[]) => {
    setIncludeArchived(values.includes('include'));
  }, []);

  const handleClearFilters = useCallback(() => {
    setIncludeArchived(false);
  }, []);

  const filterConfigs = useMemo(
    () => [
      {
        key: 'archived',
        title: t('archived.badge'),
        options: [{ value: 'include', label: t('list.showArchived') }],
        selectedValues: includeArchived ? ['include'] : [],
        onChange: handleArchivedFilterChange,
        multiSelect: true,
        widensResultSet: true,
      },
    ],
    [t, includeArchived, handleArchivedFilterChange],
  );

  const handleDeleteItem = useCallback(
    async (id: string) => {
      // RowSelectionState keys are the row IDs (Convex doc `_id` here).
      // `mode: 'detach'` matches the single-row delete dialog's default
      // (unchecked "cascade") — bulk-delete with cascade would also need a
      // per-project confirm phrase, which doesn't translate to a multi-row
      // gesture, so cascade stays single-row-only via the row dialog.
      await deleteProject({
        // RowSelectionState keys are the row `_id`s by construction (getRowId).
        projectId: toId<'projects'>(id),
        mode: 'detach',
      });
    },
    [deleteProject],
  );

  const handleRowClick = useCallback(
    (row: Row<ProjectOverviewRow>) => {
      // Skip navigation when the click came from a row-action menu trigger
      // (event bubbles up otherwise; the menu is in the same row).
      void navigate({
        to: '/dashboard/$id/projects/$projectId',
        params: { id: organizationId, projectId: String(row.original._id) },
      });
    },
    [navigate, organizationId],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<ProjectOverviewRow>) => {
      // Warm the detail route (runs its loader → getProject) on hover so the
      // click lands on already-fetched data.
      preloadRoute({
        to: '/dashboard/$id/projects/$projectId',
        params: { id: organizationId, projectId: String(row.original._id) },
      });
    },
    [preloadRoute, organizationId],
  );

  const locale =
    typeof window !== 'undefined' && window.navigator?.language
      ? window.navigator.language
      : 'en';

  const columns = useMemo<ColumnDef<ProjectOverviewRow>[]>(
    () => [
      // Multi-row select — canonical 40px column, identical to every other
      // entity table. Enables bulk delete via the `BulkDeleteBar` footer.
      createSelectColumn<ProjectOverviewRow>(),
      {
        accessorKey: 'name',
        header: t('list.columnName'),
        cell: ({ row }) => (
          // The row stays SINGLE-LINE (density matches customers/agents), so
          // the description rides on `title` rather than a second line — the
          // scent is reachable on hover at zero vertical cost.
          <HStack gap={2} align="center" className="min-w-0">
            <ProjectAvatar
              name={row.original.name}
              icon={row.original.icon}
              color={row.original.color}
              size={20}
            />
            {row.original.key ? (
              <span className="text-muted-foreground shrink-0 font-mono text-xs">
                {row.original.key}
              </span>
            ) : null}
            <span
              className="truncate text-sm font-medium"
              title={row.original.description || undefined}
            >
              {row.original.name}
              {row.original.archivedAt ? (
                <span className="text-muted-foreground ml-2 text-xs">
                  ({t('archived.badge')})
                </span>
              ) : null}
            </span>
          </HStack>
        ),
      },
      {
        id: 'tasks',
        header: t('list.columnTasks'),
        size: 132,
        enableSorting: false,
        cell: ({ row }) => {
          const done = row.original.doneTaskCount;
          // Cancelled work is in neither counter, so it never inflates the
          // denominator — see the bucket semantics on `projectsTable`.
          const total = row.original.openTaskCount + done;
          if (total === 0) {
            return (
              <span className="text-muted-foreground text-xs" aria-hidden>
                —<span className="sr-only">{t('list.noTasks')}</span>
              </span>
            );
          }
          return (
            <ProgressBar
              value={done}
              max={total}
              label={t('list.taskProgressA11y', { done, total })}
              tooltipContent={t('list.taskProgressA11y', { done, total })}
            />
          );
        },
      },
      {
        id: 'overdue',
        header: t('list.columnOverdue'),
        size: 92,
        enableSorting: false,
        cell: ({ row }) => {
          const count = row.original.overdueTaskCount;
          if (count === 0) {
            return <span className="text-muted-foreground text-xs">—</span>;
          }
          return (
            <Badge variant="destructive">
              <span aria-hidden>
                {overdueTruncated
                  ? t('list.countTruncated', { count })
                  : String(count)}
              </span>
              <span className="sr-only">
                {t('list.overdueA11y', { count })}
              </span>
            </Badge>
          );
        },
      },
      {
        id: 'agents',
        header: t('list.columnAgents'),
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <CountCell
            count={row.original.projectAgentCount}
            label={t('list.agentsA11y', {
              count: row.original.projectAgentCount,
            })}
          />
        ),
      },
      {
        id: 'files',
        header: t('list.columnFiles'),
        size: 80,
        enableSorting: false,
        cell: ({ row }) => (
          <CountCell
            count={row.original.fileCount}
            label={t('list.filesA11y', { count: row.original.fileCount })}
            truncated={filesTruncated}
            truncatedLabel={t('list.countTruncated', {
              count: row.original.fileCount,
            })}
          />
        ),
      },
      {
        accessorKey: 'sharing',
        header: t('list.columnSharing'),
        size: 88,
        cell: ({ row }) => {
          const teamCount =
            (row.original.teamId ? 1 : 0) +
            (row.original.sharedWithTeamIds?.length ?? 0);
          // Demoted from a text column to an icon: sharing is an ACL fact, and
          // it was competing for width with the execution signal above.
          const label =
            teamCount === 0
              ? t('list.sharingOrgWide')
              : t('list.sharingMultipleTeams', { count: teamCount });
          const Icon = teamCount === 0 ? Globe : Users;
          return (
            <span
              className="text-muted-foreground inline-flex items-center"
              title={label}
            >
              <Icon className="size-4" aria-hidden />
              <span className="sr-only">{label}</span>
            </span>
          );
        },
      },
      {
        accessorKey: 'updatedAt',
        header: t('list.columnActivity'),
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs">
            {formatRelative(row.original.updatedAt, locale)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        // Matches the canonical pattern shared by every other entity
        // table: `isAction` meta flag + right-justified HStack, locked to
        // `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns across the app.
        meta: { isAction: true },
        size: ACTIONS_COLUMN_SIZE,
        cell: ({ row }) => (
          <HStack justify="end">
            <ProjectRowActions
              organizationId={organizationId}
              projectId={row.original._id}
              projectName={row.original.name}
              isArchived={Boolean(row.original.archivedAt)}
              canEdit={row.original.canEdit}
              canAdminister={row.original.canAdminister}
            />
          </HStack>
        ),
        enableSorting: false,
      },
    ],
    [t, locale, organizationId, overdueTruncated, filesTruncated],
  );

  const list = useListPage<ProjectOverviewRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : projects,
    },
    pageSize: 25,
    search: {
      // `key` is visible in the row now, so typing `TAL` must find the project.
      fields: ['name', 'description', 'key'],
      placeholder: t('list.searchPlaceholder'),
    },
    filters: {
      configs: filterConfigs,
      onClear: handleClearFilters,
    },
    entityLabel: { one: t('entityLabelOne'), other: t('entityLabel') },
  });

  return (
    <>
      <DataTable
        // `p-4` gives this table the same 16px page inset every other
        // top-level entity table has — knowledge tables inherit it from the
        // `_knowledge` layout's `<ContentArea py-4>`, agents sets it here the
        // same way. `PageLayout` itself adds no padding, so without this the
        // table renders flush to the edge (no gap) and its select / 3-dot
        // columns sit out of line with the rest of the app.
        className="p-4"
        {...list.tableProps}
        columns={columns}
        enableRowSelection
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        onRowClick={handleRowClick}
        onRowMouseEnter={handleRowMouseEnter}
        actionMenu={
          <DataTableActionMenu
            label={t('list.createButton')}
            icon={Plus}
            onClick={() => setCreateOpen(true)}
          />
        }
        emptyState={{
          icon: Folder,
          title: t('list.emptyTitle'),
          description: t('list.emptyDescription'),
          headingLevel: 2,
          action: (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setCreateOpen(true)}
            >
              {t('list.emptyCta')}
            </Button>
          ),
        }}
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
      />
      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
    </>
  );
}
