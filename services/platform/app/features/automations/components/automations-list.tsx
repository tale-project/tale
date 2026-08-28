'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import {
  CheckCircle2,
  CircleDashed,
  FileUp,
  FolderKanban,
  Plus,
  Workflow,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { ACTIONS_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { useProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { useListPage } from '@/app/hooks/use-list-page';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { automationDisplayName } from '@/lib/shared/schemas/automation_presentation';

import { useAutomations } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import { automationListTarget } from '../lib/list-target';
import { AutomationRowActions } from './automation-row-actions';
import { BlankAutomationDialog } from './blank-automation-dialog';
import { NewAutomationDialog } from './new-automation-dialog';
import { UploadAutomationDialog } from './upload-automation-dialog';

interface AutomationListRow {
  name: string;
  displayName: string;
  latest: number;
  projectIds: Id<'projects'>[];
  deployedVersion?: number;
  presentation?: unknown;
}

const PAGE_SIZE = 25;

/**
 * The organization's automations — or one project's, when rendered in that
 * project's Automations tab.
 *
 * A DataTable like Projects: full-width rows under the area header, create in
 * the toolbar, search, and a row menu for delete. Each row still answers the
 * two questions the list can — how many versions exist, and which one (if any)
 * is live — so an undeployed draft cannot be mistaken for a running schedule.
 *
 * The area shell already owns the page title (`AdaptiveHeaderTitle`).
 */
export function AutomationsList({
  organizationId,
  projectId,
}: {
  organizationId: string;
  /** Render one project's automations (links stay inside the project shell). */
  projectId?: Id<'projects'>;
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const ability = useAbility();
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const [createDialog, setCreateDialog] = useState<
    'builder' | 'blank' | 'upload' | null
  >(null);
  const automationsQuery = useAutomations(
    organizationId,
    projectId,
    projectId === undefined,
  );
  const { projects } = useProjects(organizationId);
  const projectNames = useMemo(
    () =>
      new Map<string, string>(
        projects.map((project) => [project._id, project.name]),
      ),
    [projects],
  );
  const canAuthor = ability.can('read', 'developerSettings');
  const showProjectsColumn = projectId === undefined;

  const rows = useMemo<AutomationListRow[]>(() => {
    const listed = [...(automationsQuery.data ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return listed.map((automation) => {
      const row: AutomationListRow = {
        name: automation.name,
        displayName: automationDisplayName(
          automation.presentation,
          automation.name,
          locale,
        ),
        latest: automation.latest,
        projectIds: automation.projectIds,
        presentation: automation.presentation,
      };
      if (
        'deployedVersion' in automation &&
        automation.deployedVersion !== undefined
      ) {
        row.deployedVersion = automation.deployedVersion;
      }
      return row;
    });
  }, [automationsQuery.data, locale]);

  const columns = useMemo<ColumnDef<AutomationListRow>[]>(() => {
    const cols: ColumnDef<AutomationListRow>[] = [
      {
        accessorKey: 'displayName',
        header: t('list.columnName'),
        size: 280,
        cell: ({ row }) => (
          <span className="flex min-w-0 flex-col">
            <span className="truncate text-sm font-medium">
              {row.original.displayName}
            </span>
            {/* The slug stays visible on the admin surface: it is what the
                store, the CLI and the run log address. */}
            <span className="text-muted-foreground truncate text-xs">
              {row.original.name}
            </span>
          </span>
        ),
      },
    ];
    if (showProjectsColumn) {
      cols.push({
        id: 'projects',
        header: t('list.columnProjects'),
        size: 180,
        cell: ({ row }) =>
          row.original.projectIds.length === 0 ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <HStack gap={1} wrap>
              {row.original.projectIds.map((boundProjectId) => (
                <Badge key={boundProjectId} variant="blue" icon={FolderKanban}>
                  {projectNames.get(boundProjectId) ?? t('list.projectBound')}
                </Badge>
              ))}
            </HStack>
          ),
      });
    }
    cols.push(
      {
        accessorKey: 'latest',
        header: t('list.columnVersions'),
        size: 120,
        cell: ({ row }) => (
          <Badge variant="slate">
            {t('list.versionCount', { count: row.original.latest })}
          </Badge>
        ),
      },
      {
        id: 'status',
        header: t('list.columnStatus'),
        size: 140,
        cell: ({ row }) =>
          row.original.deployedVersion === undefined ? (
            <Badge variant="yellow" icon={CircleDashed}>
              {t('list.notDeployed')}
            </Badge>
          ) : (
            <Badge variant="green" icon={CheckCircle2}>
              {t('detail.deployedVersion', {
                version: row.original.deployedVersion,
              })}
            </Badge>
          ),
      },
    );
    if (canAuthor) {
      cols.push({
        id: 'actions',
        header: '',
        meta: { isAction: true },
        size: ACTIONS_COLUMN_SIZE,
        enableSorting: false,
        cell: ({ row }) => (
          <HStack
            justify="end"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <AutomationRowActions
              organizationId={organizationId}
              name={row.original.name}
              displayName={row.original.displayName}
            />
          </HStack>
        ),
      });
    }
    return cols;
  }, [t, showProjectsColumn, projectNames, canAuthor, organizationId]);

  const list = useListPage<AutomationListRow>({
    dataSource: {
      type: 'query',
      data: automationsQuery.isPending ? undefined : rows,
    },
    pageSize: PAGE_SIZE,
    search: {
      fields: ['displayName', 'name'],
      placeholder: t('list.searchPlaceholder'),
    },
    getRowId: (row) => row.name,
    entityLabel: {
      one: t('entityLabelOne'),
      other: t('entityLabel'),
    },
  });

  const handleRowClick = useCallback(
    (row: Row<AutomationListRow>) => {
      void navigate(
        automationListTarget({
          organizationId,
          name: row.original.name,
          boundProjectIds: row.original.projectIds,
          ...(projectId !== undefined && { listProjectId: projectId }),
        }),
      );
    },
    [navigate, organizationId, projectId],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<AutomationListRow>) => {
      preloadRoute(
        automationListTarget({
          organizationId,
          name: row.original.name,
          boundProjectIds: row.original.projectIds,
          ...(projectId !== undefined && { listProjectId: projectId }),
        }),
      );
    },
    [preloadRoute, organizationId, projectId],
  );

  const createMenuItems = canAuthor
    ? [
        {
          label: t('createMenu.fromGoal'),
          icon: Plus,
          onClick: () => setCreateDialog('builder'),
        },
        {
          label: t('createMenu.blank'),
          icon: Workflow,
          onClick: () => setCreateDialog('blank'),
        },
        {
          label: t('upload.trigger'),
          icon: FileUp,
          onClick: () => setCreateDialog('upload'),
        },
      ]
    : undefined;

  return (
    <>
      {createDialog === 'builder' && (
        <NewAutomationDialog
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          open
          onOpenChange={(next) => {
            if (!next) setCreateDialog(null);
          }}
        />
      )}
      {createDialog === 'blank' && (
        <BlankAutomationDialog
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          open
          onOpenChange={(next) => {
            if (!next) setCreateDialog(null);
          }}
        />
      )}
      {createDialog === 'upload' && (
        <UploadAutomationDialog
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          open
          onOpenChange={(next) => {
            if (!next) setCreateDialog(null);
          }}
        />
      )}

      {automationsQuery.isError && (
        <div className="px-4 pt-4">
          <Alert
            variant="destructive"
            description={t('list.loadFailed', {
              error: automationErrorMessage(automationsQuery.error),
            })}
          />
        </div>
      )}

      {!automationsQuery.isError && (
        <DataTable
          className="p-4"
          caption={t('title')}
          columns={columns}
          onRowClick={handleRowClick}
          onRowMouseEnter={handleRowMouseEnter}
          addAction={
            createMenuItems !== undefined
              ? {
                  label: t('list.createButton'),
                  icon: Plus,
                  menuItems: createMenuItems,
                }
              : undefined
          }
          emptyState={{
            icon: Workflow,
            title: t('list.empty.title'),
            description: t('list.empty.description'),
            headingLevel: 2,
          }}
          {...list.tableProps}
        />
      )}
    </>
  );
}
