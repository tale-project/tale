'use client';

import { Badge } from '@tale/ui/badge';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import { BulkArchiveBar } from '@tale/ui/data-table/data-table-bulk-actions';
import { HStack } from '@tale/ui/layout';
import { ProgressBar } from '@tale/ui/progress-bar';
import { useListPage } from '@tale/ui/use-list-page';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row, RowSelectionState } from '@tanstack/react-table';
import { Folder, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

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
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
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

export function ProjectsTable({
  organizationId,
  teamFilter,
  onTeamFilterChange,
}: ProjectsTableProps) {
  const { t } = useT('projects');
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const [includeArchived, setIncludeArchived] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { projects, isLoading, overdueTruncated } = useProjectsOverview(
    organizationId,
    { includeArchived },
  );
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

  const locale =
    typeof window !== 'undefined' && window.navigator?.language
      ? window.navigator.language
      : 'en';

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
            <span
              className="min-w-0 truncate text-sm font-medium"
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
            </span>
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
    [t, locale, organizationId, overdueTruncated, nameOf, isLoadingTeams],
  );

  const list = useListPage<ProjectOverviewRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : visibleProjects,
    },
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
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
        // The page inset comes from the route's `ContentArea variant="list"`,
        // which also bounds the height this sticky frame fills — so the
        // toolbar and the header row stay put and only the rows scroll.
        stickyLayout
        {...list.tableProps}
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
        addAction={{
          label: t('list.createButton'),
          icon: Plus,
          onClick: () => setCreateOpen(true),
        }}
        emptyState={{
          icon: Folder,
          title: t('list.emptyTitle'),
          description: t('list.emptyDescription'),
          headingLevel: 2,
        }}
        footer={
          <BulkArchiveBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onArchiveItem={handleArchiveItem}
            onComplete={handleClearSelection}
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
