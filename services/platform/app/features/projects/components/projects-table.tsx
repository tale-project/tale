'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row, RowSelectionState } from '@tanstack/react-table';
import { Folder, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useListPage } from '@/app/hooks/use-list-page';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { toId } from '@/convex/lib/type_cast_helpers';
import { useT } from '@/lib/i18n/client';

import { useDeleteProject } from '../hooks/mutations';
import { useProjects, type ProjectListItem } from '../hooks/queries';
import { ProjectCreateDialog } from './project-create-dialog';
import { ProjectRowActions } from './project-row-actions';

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
  const { projects, isLoading } = useProjects(organizationId, {
    includeArchived,
  });
  const { mutateAsync: deleteProject } = useDeleteProject();

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

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
    (row: Row<ProjectListItem>) => {
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
    (row: Row<ProjectListItem>) => {
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

  const columns = useMemo<ColumnDef<ProjectListItem>[]>(
    () => [
      // Multi-row select — canonical 40px column, identical to every other
      // entity table. Enables bulk delete via the `BulkDeleteBar` footer.
      createSelectColumn<ProjectListItem>(),
      {
        accessorKey: 'name',
        header: t('list.columnName'),
        cell: ({ row }) => (
          // U2: no folder icon. Description was previously shown below the
          // name but is now removed per follow-up feedback — it's available
          // on the project detail page, and the row stays single-line so
          // the table density matches customers/agents.
          <span className="truncate text-sm font-medium">
            {row.original.name}
            {row.original.archivedAt ? (
              <span className="text-muted-foreground ml-2 text-xs">
                ({t('archived.badge')})
              </span>
            ) : null}
          </span>
        ),
      },
      {
        accessorKey: 'sharing',
        header: t('list.columnSharing'),
        cell: ({ row }) => {
          const teamCount =
            (row.original.teamId ? 1 : 0) +
            (row.original.sharedWithTeamIds?.length ?? 0);
          if (teamCount === 0) {
            return (
              <span className="text-muted-foreground text-xs">
                {t('list.sharingOrgWide')}
              </span>
            );
          }
          return (
            <span className="text-muted-foreground text-xs">
              {t('list.sharingMultipleTeams', { count: teamCount })}
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
    [t, locale, organizationId],
  );

  const list = useListPage<ProjectListItem>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : projects,
    },
    pageSize: 25,
    search: {
      fields: ['name', 'description'],
      placeholder: t('list.searchPlaceholder'),
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
        filtersContent={
          <Checkbox
            id="projects-show-archived"
            checked={includeArchived}
            onCheckedChange={(v) => setIncludeArchived(Boolean(v))}
            label={t('list.showArchived')}
          />
        }
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
