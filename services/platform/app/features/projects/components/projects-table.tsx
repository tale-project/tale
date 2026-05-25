'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import { FolderKanban } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useListPage } from '@/app/hooks/use-list-page';
import { useT } from '@/lib/i18n/client';

import { useProjects, type ProjectListItem } from '../hooks/queries';
import { ProjectAvatar } from './project-avatar';
import { ProjectCreateDialog } from './project-create-dialog';

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
          <div className="flex min-w-0 items-center gap-2">
            <ProjectAvatar
              name={row.original.name}
              icon={row.original.icon}
              color={row.original.color}
              size={24}
            />
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-sm font-medium">
                {row.original.name}
                {row.original.archivedAt ? (
                  <span className="text-muted-foreground ml-2 text-xs">
                    ({t('settings.archiveButton')})
                  </span>
                ) : null}
              </span>
              {row.original.description ? (
                <span className="text-muted-foreground truncate text-xs">
                  {row.original.description}
                </span>
              ) : null}
            </div>
          </div>
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
    ],
    [t, locale],
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
  });

  return (
    <>
      <DataTable
        className="p-4"
        {...list.tableProps}
        columns={columns}
        onRowClick={handleRowClick}
        actionMenu={
          <div className="flex items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIncludeArchived((v) => !v)}
            >
              {includeArchived ? '✓ ' : ''}
              {t('list.showArchived')}
            </Button>
            <Button size="sm" onClick={() => setCreateOpen(true)}>
              {t('list.createButton')}
            </Button>
          </div>
        }
        emptyState={{
          icon: FolderKanban,
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
