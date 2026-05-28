'use client';

import { HStack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { Folder, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

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
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const { projects, isLoading } = useProjects(organizationId, {
    includeArchived,
  });

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

  const locale =
    typeof window !== 'undefined' && window.navigator?.language
      ? window.navigator.language
      : 'en';

  const columns = useMemo<ColumnDef<ProjectListItem>[]>(
    () => [
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
        // Matches the canonical pattern shared by agents / customers /
        // documents / vendors / products / websites tables: `isAction`
        // meta flag + right-justified HStack. The DataTable applies the
        // platform's standard action-cell width + alignment from this
        // meta hint.
        meta: { isAction: true },
        size: 56,
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
    entityLabel: t('entityLabel'),
  });

  return (
    <>
      <DataTable
        className="p-4"
        {...list.tableProps}
        columns={columns}
        onRowClick={handleRowClick}
        actionMenu={
          <div className="flex items-center gap-3">
            <Checkbox
              id="projects-show-archived"
              checked={includeArchived}
              onCheckedChange={(v) => setIncludeArchived(Boolean(v))}
              label={t('list.showArchived')}
            />
            <DataTableActionMenu
              label={t('list.createButton')}
              icon={Plus}
              onClick={() => setCreateOpen(true)}
            />
          </div>
        }
        emptyState={{
          icon: Folder,
          title: t('list.emptyTitle'),
          description: t('list.emptyDescription'),
        }}
      />
      <ProjectCreateDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        organizationId={organizationId}
      />
    </>
  );
}
