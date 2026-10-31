'use client';

import { Badge } from '@tale/ui/badge';
import { CatalogLoadError } from '@tale/ui/catalog/catalog-view';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkArchiveBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { HStack } from '@tale/ui/layout';
import { ProgressBar } from '@tale/ui/progress-bar';
import { useFormatDate } from '@tale/ui/use-format-date';
import { useListPage } from '@tale/ui/use-list-page';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row, RowSelectionState } from '@tanstack/react-table';
import { Folder, Plus } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { TeamAudienceCell } from '@/app/features/settings/teams/components/team-audience-cell';
import {
  useTeamNames,
  useTeams,
} from '@/app/features/settings/teams/hooks/queries';
import {
  audienceMatcher,
  MY_TEAMS_AUDIENCE,
  ORG_WIDE_AUDIENCE,
} from '@/app/features/settings/teams/lib/audience-filter';
import { useAbility } from '@/app/hooks/use-ability';
import { useListReadRecovery } from '@/app/hooks/use-list-read-recovery';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { firstFailureDetail } from '@/app/lib/backend/adapters';
import { useT } from '@/lib/i18n/client';

import { useArchiveProject } from '../hooks/mutations';
import { useProjectsOverview, type ProjectOverviewRow } from '../hooks/queries';
import { ProjectAvatar } from './project-avatar';
import { ProjectCreateDialog } from './project-create-dialog';
import { ProjectRowActions } from './project-row-actions';

/**
 * A plain count cell: an em-dash at zero so an empty project reads as empty
 * rather than as a stack of noisy zeros.
 */
function CountCell({ count, label }: { count: number; label: string }) {
  if (count === 0) {
    return <span className="text-muted-foreground text-xs">—</span>;
  }
  return (
    <span className="text-xs tabular-nums">
      <span aria-hidden>{count}</span>
      <span className="sr-only">{label}</span>
    </span>
  );
}

interface ProjectsTableProps {
  organizationId: string;
  /**
   * The Teams filter's selection when the page owns it (the URL): team ids
   * and/or the `ORG_WIDE_AUDIENCE` / `MY_TEAMS_AUDIENCE` tokens. Absent, the
   * table keeps the selection itself.
   */
  teamFilter?: string[];
  onTeamFilterChange?: (teamIds: string[]) => void;
}

/** A project's audience — the array, else the legacy owning + shared pair. */
function projectTeamIds(project: {
  teamIds?: string[];
  teamId?: string;
  sharedWithTeamIds?: string[];
}): string[] {
  if (project.teamIds !== undefined) return project.teamIds;
  return [
    ...(project.teamId ? [project.teamId] : []),
    ...(project.sharedWithTeamIds ?? []),
  ];
}

export function ProjectsTable({
  organizationId,
  teamFilter,
  onTeamFilterChange,
}: ProjectsTableProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  // Creating a project takes the Editor role or higher; the server refuses
  // anyone else, so a Member is not offered the door.
  const canCreate = useAbility().can('write', 'projects');
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // One page of projects at a time, newest first: scrolling, a search and
  // the Teams filter ask for the next.
  const overview = useProjectsOverview(organizationId, { includeArchived });
  const { projects, status: pageStatus, loadMore: loadMorePage } = overview;
  const { mutateAsync: archiveProject } = useArchiveProject();
  // Names resolve through the org's team DIRECTORY (every team, for any
  // member) so a row shared with a team the viewer is not in still says
  // which; the viewer's OWN teams feed the "My teams" audience filter.
  const {
    teams: directoryTeams,
    nameOf,
    isLoading: isLoadingTeams,
  } = useTeamNames();
  const { teams: myTeams } = useTeams();
  const myTeamIds = useMemo(
    () => (myTeams ?? []).map((team) => team.id),
    [myTeams],
  );

  // The Teams filter lives in the URL when the page owns it (shareable,
  // survives a reload); the table keeps it itself otherwise.
  const [localTeamFilter, setLocalTeamFilter] = useState<string[]>([]);
  const selectedTeamIds = teamFilter ?? localTeamFilter;
  const setSelectedTeamIds = useCallback(
    (teamIds: string[]) => {
      if (onTeamFilterChange) onTeamFilterChange(teamIds);
      else setLocalTeamFilter(teamIds);
    },
    [onTeamFilterChange],
  );
  const visibleProjects = useMemo(() => {
    if (selectedTeamIds.length === 0) return projects;
    const matches = audienceMatcher(selectedTeamIds, myTeamIds);
    return projects.filter((project) => matches(projectTeamIds(project)));
  }, [projects, selectedTeamIds, myTeamIds]);

  // The Teams filter narrows the LOADED pages, and the list asks for the
  // next page only as the reader scrolls — so a match past them would read
  // as none. While the filter is on, every page loads and it scans them all,
  // as the documents list does. (A search drains in `useListPage` itself.)
  useEffect(() => {
    if (selectedTeamIds.length > 0 && pageStatus === 'CanLoadMore') {
      loadMorePage(200);
    }
  }, [selectedTeamIds.length, pageStatus, loadMorePage]);

  // Against the rows the table holds: with none, it shows a failed read
  // itself; with some, the failure is named above them.
  const { regionRef, retryRead, focusRegion, failedWithRows } =
    useListReadRecovery({
      error: overview.error,
      results: visibleProjects,
      retry: overview.retry,
    });

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleArchivedFilterChange = useCallback((values: string[]) => {
    setIncludeArchived(values.includes('include'));
  }, []);

  const handleClearFilters = useCallback(() => {
    setIncludeArchived(false);
    setSelectedTeamIds([]);
  }, [setSelectedTeamIds]);

  const filterConfigs = useMemo(() => {
    const configs = [
      {
        key: 'archived',
        title: t('archived.badge'),
        options: [{ value: 'include', label: t('list.showArchived') }],
        selectedValues: includeArchived ? ['include'] : [],
        onChange: handleArchivedFilterChange,
        multiSelect: true,
        widensResultSet: true,
      },
    ];
    // By AUDIENCE: organization-wide projects, the ones any of the viewer's
    // teams may see, and each team by name. Only offered once the org has
    // teams.
    if (directoryTeams && directoryTeams.length > 0) {
      configs.push({
        key: 'teams',
        title: t('list.columnSharing'),
        options: [
          { value: ORG_WIDE_AUDIENCE, label: t('list.sharingOrgWide') },
          ...(myTeamIds.length > 0
            ? [{ value: MY_TEAMS_AUDIENCE, label: t('list.filterMyTeams') }]
            : []),
          ...directoryTeams.map((team) => ({
            value: team.id,
            label: team.name,
          })),
        ],
        selectedValues: selectedTeamIds,
        onChange: setSelectedTeamIds,
        multiSelect: true,
        widensResultSet: false,
      });
    }
    return configs;
  }, [
    t,
    includeArchived,
    handleArchivedFilterChange,
    directoryTeams,
    myTeamIds,
    selectedTeamIds,
    setSelectedTeamIds,
  ]);

  const handleArchiveItem = useCallback(
    async (id: string) => {
      // RowSelectionState keys are the row `_id`s by construction (getRowId).
      await archiveProject({
        projectId: id,
      });
    },
    [archiveProject],
  );

  const handleRowClick = useCallback(
    (row: Row<ProjectOverviewRow>) => {
      // Skip navigation when the click came from a row-action menu trigger
      // (event bubbles up otherwise; the menu is in the same row).
      void navigate({
        to: '/dashboard/$id/projects/$projectId/tasks',
        params: { id: organizationId, projectId: row.original._id },
      });
    },
    [navigate, organizationId],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<ProjectOverviewRow>) => {
      // Warm the detail route (runs its loader → getProject) on hover so the
      // click lands on already-fetched data.
      preloadRoute({
        to: '/dashboard/$id/projects/$projectId/tasks',
        params: { id: organizationId, projectId: row.original._id },
      });
    },
    [preloadRoute, organizationId],
  );

  // In the app's language, not the browser's, and in months or years once
  // days stop reading well: the age a project's Chats tab shows its chats.
  const { formatRelative } = useFormatDate();

  const columns = useMemo<ColumnDef<ProjectOverviewRow>[]>(
    () => [
      // Multi-row select for bulk archive only. Delete stays on the per-row
      // ProjectDeleteDialog (cascade + confirm phrase) — projects are too
      // high-value for a bulk-delete gesture.
      createSelectColumn<ProjectOverviewRow>(),
      {
        accessorKey: 'name',
        header: t('list.columnName'),
        // Implicit first-column flex + a larger size ratio than Activity so
        // names lead without a fixed-px or meta.flex pin (those either
        // truncated names or clustered Overdue…Activity on the far right).
        size: 240,
        meta: {
          skeleton: {
            type: 'icon-text',
            icon: <ProjectAvatar name="" size={20} />,
          },
        },
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
            {/* The name is the row's real link: `onRowClick` is a pointer
                convenience a `<tr>` cannot offer the keyboard. The link stops
                its click at itself so the row does not navigate twice. */}
            <Link
              to="/dashboard/$id/projects/$projectId/tasks"
              params={{ id: organizationId, projectId: row.original._id }}
              onClick={(event) => event.stopPropagation()}
              className="focus-visible:ring-ring min-w-0 truncate rounded-sm text-sm font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
              title={
                row.original.description
                  ? `${row.original.name} — ${row.original.description}`
                  : row.original.name
              }
            >
              {row.original.name}
              {row.original.archivedAt ? (
                <span className="text-muted-foreground ml-2 text-xs">
                  ({t('archived.badge')})
                </span>
              ) : null}
            </Link>
          </HStack>
        ),
      },
      {
        id: 'tasks',
        header: t('list.columnTasks'),
        // Proportional sibling — grows with the row so metadata columns aren't
        // packed against the right edge behind a flex Tasks canyon.
        size: 152,
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
        // Always shown — compact badge/dash. Agents/sharing/activity still
        // progressive-disclose below so Name keeps room on small screens.
        enableSorting: false,
        cell: ({ row }) => {
          const count = row.original.overdueTaskCount;
          if (count === 0) {
            return <span className="text-muted-foreground text-xs">—</span>;
          }
          return (
            <Badge variant="destructive">
              <span aria-hidden>{count}</span>
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
        meta: { className: 'hidden md:table-cell' },
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
        accessorKey: 'sharing',
        header: t('list.columnSharing'),
        size: 160,
        meta: {
          className: 'hidden md:table-cell',
          skeleton: { type: 'badge' },
        },
        cell: ({ row }) => (
          // The audience, by NAME: who can open this project is the fact a
          // member of two teams needs at a glance. An icon alone said only
          // "some teams"; the names come from the directory so a team the
          // viewer is not in still reads as itself. The documents list's
          // Teams column is this same cell.
          <TeamAudienceCell
            teamIds={projectTeamIds(row.original)}
            nameOf={nameOf}
            isLoading={isLoadingTeams}
            labels={{
              orgWide: t('list.sharingOrgWide'),
              unknownTeam: t('list.unknownTeam'),
              more: (count) => t('list.sharingMoreTeams', { count }),
            }}
          />
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: t('list.columnActivity'),
        // Below TanStack's default 150 so Last activity doesn't rival Name.
        size: 136,
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <span className="text-muted-foreground text-xs whitespace-nowrap">
            {formatRelative(new Date(row.original.updatedAt))}
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
    [t, formatRelative, organizationId, nameOf, isLoadingTeams],
  );

  const list = useListPage<ProjectOverviewRow>({
    dataSource: {
      type: 'paginated',
      results: visibleProjects,
      status: pageStatus,
      loadMore: loadMorePage,
      isLoading: overview.isLoading,
      // A failed first page is the table's error state with its retry,
      // never "No projects yet".
      error: overview.error,
      retry: retryRead,
    },
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
    search: {
      // `key` is visible in the row now, so typing `TAL` must find the project.
      // Client-side over the loaded pages, so a search loads every page.
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
      {/* Rows already on screen outlive a failed read — a refresh, or a page
          a scroll, a search or the Teams filter asked for — and the failure
          is named above them. */}
      <div
        ref={regionRef}
        role="region"
        aria-label={t('title')}
        tabIndex={-1}
        className="flex min-h-0 flex-1 flex-col gap-6 outline-none"
      >
        {failedWithRows && (
          <CatalogLoadError
            // Each failure is announced again; Try again keeps its node.
            failureKey={overview.errorCount}
            onFocusLost={focusRegion}
            message={t('list.refreshFailed')}
            onRetry={retryRead}
            isRetrying={overview.isRetrying}
          />
        )}
        <DataTable
          // The page inset comes from the route's `ContentArea variant="list"`,
          // which also bounds the height this sticky frame fills — so the
          // toolbar and the header row stay put and only the rows scroll.
          stickyLayout
          {...list.tableProps}
          // A refresh the reader did not start takes the table's error state
          // away while it runs; a focused Try again hands its focus to the
          // list, not to the page.
          onErrorFocusLost={focusRegion}
          columns={columns}
          // Mirror single-row archive gating: only admins, and skip rows that
          // are already archived (restore stays on the row menu).
          enableRowSelection={(row) =>
            row.original.canAdminister && !row.original.archivedAt
          }
          rowSelection={rowSelection}
          onRowSelectionChange={setRowSelection}
          onRowClick={handleRowClick}
          onRowMouseEnter={handleRowMouseEnter}
          addAction={
            canCreate
              ? {
                  label: t('list.createButton'),
                  icon: Plus,
                  onClick: () => setCreateOpen(true),
                }
              : undefined
          }
          emptyState={{
            icon: Folder,
            title: t('list.emptyTitle'),
            description: canCreate
              ? t('list.emptyDescription')
              : t('list.emptyReaderDescription'),
            headingLevel: 2,
          }}
          footer={
            <BulkArchiveBar
              rowSelection={rowSelection}
              onRowSelectionChange={setRowSelection}
              getItemLabel={(id) =>
                projects.find((item) => item._id === id)?.name ?? id
              }
              onClearSelection={handleClearSelection}
              onArchiveItem={handleArchiveItem}
              onComplete={handleClearSelection}
              describeFailure={firstFailureDetail}
            />
          }
        />
      </div>
      {canCreate && (
        <ProjectCreateDialog
          open={createOpen}
          onOpenChange={setCreateOpen}
          organizationId={organizationId}
        />
      )}
    </>
  );
}
