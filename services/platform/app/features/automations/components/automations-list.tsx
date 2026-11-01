'use client';

import { Alert } from '@tale/ui/alert';
import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { DataTable } from '@tale/ui/data-table/data-table';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { useListPage } from '@tale/ui/use-list-page';
import { Link, useNavigate } from '@tanstack/react-router';
import type { ColumnDef, Row } from '@tanstack/react-table';
import {
  Bot,
  CheckCircle2,
  CircleDashed,
  FileUp,
  FolderKanban,
  LayoutTemplate,
  Plus,
  Workflow,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { useNamedProjects } from '@/app/features/projects/hooks/queries';
import { useAbility } from '@/app/hooks/use-ability';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useT } from '@/lib/i18n/client';
import {
  automationDisplayIcon,
  automationDisplayLabels,
  automationDisplayName,
} from '@/lib/shared/schemas/automation_presentation';

import { useAutomations } from '../hooks/queries';
import { automationErrorMessage } from '../lib/errors';
import {
  automationListTarget,
  automationVersionsTarget,
} from '../lib/list-target';
import type { TemplateCategory } from '../lib/templates';
import { AutomationIcon } from './automation-icon';
import { AutomationRowActions } from './automation-row-actions';
import { BlankAutomationDialog } from './blank-automation-dialog';
import { CodingAgentDialog } from './coding-agent-entry';
import { TemplateCatalogDialog } from './template-catalog-dialog';
import {
  type TriggerReadiness,
  TriggerReadinessBadge,
  triggerReadinessOf,
} from './trigger-readiness-badge';
import { UploadAutomationDialog } from './upload-automation-dialog';

const NO_PROJECT_IDS: readonly string[] = [];

interface AutomationListRow {
  name: string;
  displayName: string;
  /** Iconify id of the pack's declared glyph; absent → the neutral fallback. */
  icon?: string;
  /** The pack's catalog chips, in declaration order. */
  labels: string[];
  latest: number;
  projectIds: string[];
  deployedVersion?: number;
  /** Whether its trigger starts runs on its own, apart from the version. */
  trigger: TriggerReadiness;
  presentation?: unknown;
}

/**
 * The organization's automations — or one project's, when rendered in that
 * project's Automations tab.
 *
 * A DataTable like Projects and the Knowledge tables: full-width rows under
 * the area header, create in the toolbar, search, and a row menu for delete.
 * Each row still answers the questions the list can — how many versions
 * exist, which one (if any) is live, and, apart from that, whether its
 * trigger starts runs on its own — so an undeployed draft cannot be
 * mistaken for a running schedule, nor a paused schedule for a live one.
 *
 * The area shell owns the page title (`AdaptiveHeaderTitle`) and the
 * `ContentArea variant="list"` frame this table measures its `stickyLayout`
 * scrollport against.
 */
export function AutomationsList({
  organizationId,
  projectId,
  openTemplates,
}: {
  organizationId: string;
  /** Render one project's automations (links stay inside the project shell). */
  projectId?: string;
  /** Open the template catalog as the list opens, on this tab (`all` for
   * every template) — what a link to the catalog asks for, such as the
   * Inbox's setup notice. */
  openTemplates?: TemplateCategory | 'all';
}) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const ability = useAbility();
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const [createDialog, setCreateDialog] = useState<
    'templates' | 'agent' | 'blank' | 'upload' | null
  >(openTemplates === undefined ? null : 'templates');
  // The tab a link opened the catalog on; the catalog opened from the list
  // itself starts on All.
  const [catalogTab, setCatalogTab] = useState(openTemplates);
  const automationsQuery = useAutomations(
    organizationId,
    projectId,
    projectId === undefined,
  );
  const canAuthor = ability.can('read', 'developerSettings');
  const showProjectsColumn = projectId === undefined;
  // The projects column names the projects the rows are bound to, each read
  // from the page of projects or by id: never every project (#5204).
  const boundProjectIds = useMemo(
    () =>
      showProjectsColumn
        ? (automationsQuery.data ?? []).flatMap(
            (automation) => automation.projectIds,
          )
        : NO_PROJECT_IDS,
    [showProjectsColumn, automationsQuery.data],
  );
  const { projects: projectNames } = useNamedProjects(
    organizationId,
    boundProjectIds,
  );

  const rows = useMemo<AutomationListRow[]>(() => {
    const listed = [...(automationsQuery.data ?? [])].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return listed.map((automation) => {
      const icon = automationDisplayIcon(automation.presentation);
      const row: AutomationListRow = {
        name: automation.name,
        displayName: automationDisplayName(
          automation.presentation,
          automation.name,
          locale,
        ),
        labels: automationDisplayLabels(automation.presentation),
        latest: automation.latest,
        projectIds: automation.projectIds,
        trigger: triggerReadinessOf(
          automation.trigger,
          automation.deployedVersion !== undefined,
        ),
        presentation: automation.presentation,
      };
      if (icon !== undefined) row.icon = icon;
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
        meta: { skeleton: tableIconCellSkeleton({ lines: 2 }) },
        cell: ({ row }) => (
          <TableIconCell
            // The pack's declared glyph in the tile every entity list leads
            // with; a canvas-authored automation gets the neutral fallback.
            icon={<AutomationIcon icon={row.original.icon} />}
            // The name is the row's real link: `onRowClick` is a pointer
            // convenience a `<tr>` cannot offer the keyboard. The link stops
            // its click at itself so the row does not navigate a second time.
            label={
              <Link
                {...automationListTarget({
                  organizationId,
                  name: row.original.name,
                  boundProjectIds: row.original.projectIds,
                  ...(projectId !== undefined && { listProjectId: projectId }),
                })}
                title={row.original.displayName}
                onClick={(event) => event.stopPropagation()}
                className="focus-visible:ring-ring min-w-0 rounded-sm hover:underline focus-visible:ring-2 focus-visible:outline-none"
              >
                <Text as="span" variant="label" truncate className="block">
                  {row.original.displayName}
                </Text>
              </Link>
            }
            // Catalog chips the pack declared — proper nouns, so they read the
            // same in every locale.
            badges={row.original.labels.map((label) => (
              <Badge
                key={label}
                variant="slate"
                className="hidden shrink-0 px-1.5 py-px text-[10px] md:inline-flex"
              >
                {label}
              </Badge>
            ))}
            // The slug stays visible on the admin surface: it is what the
            // store, the CLI and the run log address.
            caption={row.original.name}
          />
        ),
      },
    ];
    if (showProjectsColumn) {
      cols.push({
        id: 'projects',
        header: t('list.columnProjects'),
        size: 180,
        meta: { skeleton: { type: 'badge', badge: { variant: 'blue' } } },
        cell: ({ row }) =>
          row.original.projectIds.length === 0 ? (
            <span className="text-muted-foreground text-xs">—</span>
          ) : (
            <HStack gap={1} wrap>
              {row.original.projectIds.map((boundProjectId) => (
                <Badge key={boundProjectId} variant="blue" icon={FolderKanban}>
                  {projectNames.get(boundProjectId)?.name ??
                    t('list.projectBound')}
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
        meta: { skeleton: { type: 'badge', badge: { variant: 'slate' } } },
        // The count opens the version history; the row opens the editor.
        cell: ({ row }) => (
          <Link
            {...automationVersionsTarget({
              organizationId,
              name: row.original.name,
              boundProjectIds: row.original.projectIds,
              ...(projectId !== undefined && { listProjectId: projectId }),
            })}
            title={t('versions.actions.history')}
            onClick={(event) => event.stopPropagation()}
            className="focus-visible:ring-ring inline-flex rounded-md hover:underline focus-visible:ring-2 focus-visible:outline-none"
          >
            <Badge variant="slate">
              {t('list.versionCount', { count: row.original.latest })}
            </Badge>
          </Link>
        ),
      },
      {
        id: 'status',
        header: t('list.columnStatus'),
        size: 140,
        meta: { skeleton: { type: 'badge', badge: { variant: 'green' } } },
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
      {
        // Beside the version, never folded into it: a live version whose
        // schedule is paused or off starts nothing on its own, and one
        // without a trigger still runs by hand, the API or MCP.
        id: 'trigger',
        header: t('list.columnTrigger'),
        size: 200,
        meta: {
          skeleton: { type: 'badge-text', badge: { variant: 'slate' } },
        },
        cell: ({ row }) => (
          <TriggerReadinessBadge readiness={row.original.trigger} />
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
              onOpenVersions={() => {
                void navigate(
                  automationVersionsTarget({
                    organizationId,
                    name: row.original.name,
                    boundProjectIds: row.original.projectIds,
                    ...(projectId !== undefined && {
                      listProjectId: projectId,
                    }),
                  }),
                );
              }}
            />
          </HStack>
        ),
      });
    }
    return cols;
  }, [
    t,
    showProjectsColumn,
    projectNames,
    canAuthor,
    organizationId,
    projectId,
    navigate,
  ]);

  const list = useListPage<AutomationListRow>({
    dataSource: {
      type: 'query',
      data: automationsQuery.isPending ? undefined : rows,
    },
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
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
          label: t('createMenu.template'),
          icon: LayoutTemplate,
          onClick: () => setCreateDialog('templates'),
        },
        {
          label: t('createMenu.withAgent'),
          icon: Bot,
          onClick: () => setCreateDialog('agent'),
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
      {createDialog === 'templates' && (
        <TemplateCatalogDialog
          organizationId={organizationId}
          {...(projectId !== undefined && { projectId })}
          {...(catalogTab !== undefined &&
            catalogTab !== 'all' && { initialCategory: catalogTab })}
          open
          onOpenChange={(next) => {
            if (next) return;
            setCreateDialog(null);
            setCatalogTab(undefined);
          }}
        />
      )}
      {createDialog === 'agent' && (
        <CodingAgentDialog
          organizationId={organizationId}
          context={{
            kind: 'create',
            ...(projectId !== undefined && { projectId }),
          }}
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

      {/* Named reason beats the table's generic `error` display here: a
          provider or config fault is the usual cause and the operator needs
          to read it. The list frame supplies the inset. */}
      {automationsQuery.isError && (
        <Alert
          variant="destructive"
          description={t('list.loadFailed', {
            error: automationErrorMessage(automationsQuery.error),
          })}
        />
      )}

      {!automationsQuery.isError && (
        <DataTable
          stickyLayout
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
            // A new organization has no automation: the templates are where
            // most start.
            ...(canAuthor && {
              action: (
                <Button
                  type="button"
                  icon={LayoutTemplate}
                  onClick={() => setCreateDialog('templates')}
                >
                  {t('list.empty.browseTemplates')}
                </Button>
              ),
            }),
          }}
          {...list.tableProps}
        />
      )}
    </>
  );
}
