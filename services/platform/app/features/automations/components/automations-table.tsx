'use client';

import { LinkButton } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { useNavigate } from '@tanstack/react-router';
import {
  type ColumnDef,
  type Row,
  type RowSelectionState,
} from '@tanstack/react-table';
import { BarChart3, Network } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import { SELECT_COLUMN_SIZE } from '@/app/components/ui/data-table/column-builders';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { buildFolderView, isInFolder } from '@/lib/utils/folder-tree';
import { slugToUrlParam } from '@/lib/utils/workflow-slug';

import { useDeleteWorkflowFile } from '../hooks/file-mutations';
import { useListWorkflows } from '../hooks/file-queries';
import { useAutomationsTableConfig } from '../hooks/use-automations-table-config';
import { AutomationsActionMenu } from './automations-action-menu';

export interface WorkflowItem {
  type: 'workflow';
  slug: string;
  name: string;
  description?: string;
  stepCount: number;
  hash: string;
  /** '/'-joined folder path (every slug segment except the last). */
  folderPath: string;
  /** Owning app slug when app-owned (composite slug `<appSlug>/<name>`). */
  appSlug?: string;
  createdAtMs?: number;
}

export interface FolderItem {
  type: 'folder';
  /** Last path segment — the folder's display name. */
  name: string;
  /** Full '/'-joined path used to drill in. */
  path: string;
  workflowCount: number;
  /** Set when this top-level folder IS an installed app — marks it `[App]`. */
  appSlug?: string;
}

export type AutomationTableItem = WorkflowItem | FolderItem;

interface AutomationsTableProps {
  organizationId: string;
  currentFolder?: string;
}

function toWorkflowItem(
  w:
    | {
        slug: string;
        name: string;
        description?: string;
        stepCount: number;
        hash: string;
        createdAtMs?: number;
        appSlug?: string;
      }
    | { slug: string; status: string; message: string }
    | null,
): WorkflowItem | null {
  if (!w || !('name' in w)) return null;
  // The folder is every slug segment except the last (the workflow id), so
  // `github/issues/sync` lives in `github/issues` — arbitrarily deep. For an app
  // workflow `issue-desk/desk-process`, that folder is the app slug.
  const folderPath = w.slug.split('/').slice(0, -1).join('/');
  return { ...w, type: 'workflow', folderPath };
}

export function AutomationsTable({
  organizationId,
  currentFolder,
}: AutomationsTableProps) {
  const navigate = useNavigate();
  const { t: tAutomations } = useT('automations');
  const { t: tCommon } = useT('common');
  const { t: tEmpty } = useT('emptyStates');
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  const { workflows, isLoading, refetch } = useListWorkflows(
    organizationId,
    'installed',
  );
  // Search flattens across folders (global), so prefix each result with its
  // folder path (e.g. "github / GitHub Issue Sync") — in the root or inside a
  // folder, since results can span folders either way.
  const { columns } = useAutomationsTableConfig(organizationId, {
    showFolderPath: isSearching,
  });
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  const { mutateAsync: deleteWorkflow } = useDeleteWorkflowFile();

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleDeleteItem = useCallback(
    async (slug: string) => {
      try {
        await deleteWorkflow({ organizationId, workflowSlug: slug });
      } catch (error) {
        toast({
          title: tAutomations('delete.failed'),
          variant: 'destructive',
        });
        throw error;
      }
    },
    [deleteWorkflow, organizationId, tAutomations],
  );

  useEffect(() => {
    const handleWorkflowUpdated = () => void refetch();
    window.addEventListener('workflow-updated', handleWorkflowUpdated);
    return () => {
      window.removeEventListener('workflow-updated', handleWorkflowUpdated);
    };
  }, [refetch]);

  const validWorkflows = useMemo(
    () =>
      workflows
        ?.map(toWorkflowItem)
        .filter((w): w is WorkflowItem => w !== null),
    [workflows],
  );

  // Top-level folders whose name is an installed app — surfaced from the rows
  // that carry `appSlug` (app workflows have folderPath === appSlug). Used to
  // mark the folder group `[App]` instead of an ordinary folder.
  const appFolderSlugs = useMemo<Set<string>>(
    () =>
      new Set(
        (validWorkflows ?? [])
          .map((w) => w.appSlug)
          .filter((s): s is string => s !== undefined),
      ),
    [validWorkflows],
  );

  // The workflows represented by the current view. Search is *global*: a query
  // matches across every folder regardless of which folder you're in, so the
  // behaviour is identical at the root and inside a folder (the flat results
  // carry their folder path for context). Only the folder scoping applies when
  // there's no query. This is also the universe the header select-all and
  // folder checkboxes act on — folder rows are aggregates whose member
  // workflows aren't their own rows, so selection reaches them by slug here.
  // The workflows reachable from the current view. Search is *global* (matches
  // across every folder regardless of which folder you're in); otherwise we
  // scope to the current folder plus everything nested beneath it — the
  // universe the header select-all and folder checkboxes act on.
  const scopedWorkflows = useMemo((): WorkflowItem[] => {
    if (!validWorkflows) return [];
    const q = searchQuery.toLowerCase().trim();
    if (q) {
      return validWorkflows.filter(
        (w) =>
          w.name.toLowerCase().includes(q) ||
          w.folderPath.toLowerCase().includes(q) ||
          (w.description && w.description.toLowerCase().includes(q)),
      );
    }
    return validWorkflows.filter((w) =>
      isInFolder(w.folderPath, currentFolder ?? ''),
    );
  }, [validWorkflows, searchQuery, currentFolder]);

  const tableItems = useMemo((): AutomationTableItem[] => {
    // While searching, the list is flat: every match shows as its own row
    // (folders aren't navigable there), prefixed with its folder path.
    if (isSearching) {
      return [...scopedWorkflows].sort((a, b) => a.name.localeCompare(b.name));
    }
    // Otherwise show this folder's immediate child folders, then its direct
    // workflows — a file-explorer view that drills arbitrarily deep.
    const { subfolders, items } = buildFolderView(
      scopedWorkflows,
      (w) => w.folderPath,
      currentFolder ?? '',
    );
    const folderItems: FolderItem[] = subfolders.map((f) => ({
      type: 'folder',
      name: f.name,
      path: f.path,
      workflowCount: f.count,
      appSlug: appFolderSlugs.has(f.path) ? f.path : undefined,
    }));
    const workflowItems = [...items].sort((a, b) =>
      a.name.localeCompare(b.name),
    );
    return [...folderItems, ...workflowItems];
  }, [scopedWorkflows, currentFolder, isSearching, appFolderSlugs]);

  // folderPath → member workflow slugs (everything nested), and the flat list
  // of every selectable slug in view. Drive the folder/header checkbox state.
  // App-owned workflows can't be deleted from the global surface (only via app
  // uninstall), so they're excluded from every selectable slug set — folder
  // checkboxes and select-all never queue them for BulkDeleteBar.
  const folderMembers = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const item of tableItems) {
      if (item.type !== 'folder') continue;
      map.set(
        item.path,
        scopedWorkflows
          .filter((w) => !w.appSlug && isInFolder(w.folderPath, item.path))
          .map((w) => w.slug),
      );
    }
    return map;
  }, [tableItems, scopedWorkflows]);

  const allVisibleSlugs = useMemo(
    () => scopedWorkflows.filter((w) => !w.appSlug).map((w) => w.slug),
    [scopedWorkflows],
  );

  const toggleSlugs = useCallback((slugs: string[], selected: boolean) => {
    setRowSelection((prev) => {
      const next = { ...prev };
      for (const slug of slugs) {
        if (selected) next[slug] = true;
        else delete next[slug];
      }
      return next;
    });
  }, []);

  const checkedStateFor = useCallback(
    (slugs: string[]): boolean | 'indeterminate' => {
      if (slugs.length === 0) return false;
      const selected = slugs.filter((slug) => rowSelection[slug]).length;
      if (selected === 0) return false;
      return selected === slugs.length ? true : 'indeterminate';
    },
    [rowSelection],
  );

  // Custom select column: the header and folder-row checkboxes operate on the
  // underlying workflow *slugs* (incl. those nested in folders) so select-all
  // truly selects everything — folders included — and a folder checkbox toggles
  // all of its workflows at once. Replaces the config's generic select column.
  const selectColumn = useMemo<ColumnDef<AutomationTableItem>>(
    () => ({
      id: 'select',
      size: SELECT_COLUMN_SIZE,
      header: () => (
        <Checkbox
          checked={checkedStateFor(allVisibleSlugs)}
          onCheckedChange={(value) => toggleSlugs(allVisibleSlugs, !!value)}
          aria-label={tCommon('aria.selectAll')}
        />
      ),
      cell: ({ row }) => {
        const item = row.original;
        const slugs =
          item.type === 'folder'
            ? (folderMembers.get(item.path) ?? [])
            : [item.slug];
        return (
          <Checkbox
            checked={checkedStateFor(slugs)}
            onClick={(e) => e.stopPropagation()}
            onCheckedChange={(value) => toggleSlugs(slugs, !!value)}
            aria-label={tCommon('aria.selectRow')}
          />
        );
      },
      meta: { skeleton: { type: 'action' } },
    }),
    [allVisibleSlugs, folderMembers, checkedStateFor, toggleSlugs, tCommon],
  );

  const tableColumns = useMemo(
    () => columns.map((col) => (col.id === 'select' ? selectColumn : col)),
    [columns, selectColumn],
  );

  const handleRowClick = useCallback(
    (row: Row<AutomationTableItem>) => {
      const item = row.original;
      if (item.type === 'folder') {
        void navigate({
          to: '/dashboard/$id/automations',
          params: { id: organizationId },
          search: { folder: item.path },
        });
      } else {
        const amId = slugToUrlParam(item.slug);
        void navigate({
          to: '/dashboard/$id/automations/$amId',
          params: { id: organizationId, amId },
          search: { panel: 'ai-chat' },
        });
      }
    },
    [navigate, organizationId],
  );

  const getRowClassName = useCallback(
    (row: Row<AutomationTableItem>) =>
      row.original.type === 'folder' ? 'cursor-pointer' : '',
    [],
  );

  return (
    // `p-4` gives this page the same 16px inset every other top-level entity
    // table has (knowledge tables inherit it from the `_knowledge` layout's
    // `<ContentArea py-4>`; agents / projects set it on the table directly).
    // `PageLayout` adds no padding, so without this the table renders flush to
    // the edge — no gap, and its select / 3-dot columns sit out of line with
    // the rest of the app. `gap-4` controls the search-bar / table spacing.
    <Stack className="p-4">
      <div className="flex items-center justify-between gap-4">
        <SearchInput
          wrapperClassName="w-full max-w-sm"
          placeholder={tAutomations('search.placeholder')}
          aria-label={tAutomations('search.placeholder')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div className="flex items-center gap-2">
          <LinkButton
            href="/dashboard/$id/automations/metrics"
            params={{ id: organizationId }}
            variant="secondary"
            icon={BarChart3}
          >
            {tAutomations('metrics.link')}
          </LinkButton>
          <AutomationsActionMenu organizationId={organizationId} />
        </div>
      </div>

      <DataTable
        columns={tableColumns}
        data={tableItems}
        isLoading={isLoading}
        approxRowCount={isLoading ? 5 : tableItems.length}
        // Selection is driven by `selectColumn` (keyed by workflow slug, with
        // folder checkboxes expanding to their members). `enableRowSelection`
        // here only governs TanStack's row-highlight: workflow rows highlight
        // when selected; folder aggregates don't.
        enableRowSelection={(row) =>
          row.original.type === 'workflow' && !row.original.appSlug
        }
        rowSelection={rowSelection}
        onRowSelectionChange={setRowSelection}
        // Pin row IDs to the workflow slug (mirrors `wfDefinitionId`); folders
        // fall back to their name. RowSelectionState keys then match what
        // `handleDeleteItem` passes to the mutation.
        getRowId={(row) =>
          row.type === 'workflow' ? row.slug : `folder:${row.path}`
        }
        onRowClick={handleRowClick}
        rowClassName={getRowClassName}
        infiniteScroll={{
          hasMore: false,
          onLoadMore: () => {},
          entityLabel: tAutomations('entityLabel'),
          totalCount: validWorkflows?.length ?? 0,
        }}
        emptyState={
          searchQuery
            ? {
                title: tCommon('search.noResults'),
              }
            : {
                icon: Network,
                title: tEmpty('automations.title'),
                description: tEmpty('automations.description'),
              }
        }
        footer={
          <BulkDeleteBar
            rowSelection={rowSelection}
            onClearSelection={handleClearSelection}
            onDeleteItem={handleDeleteItem}
            onDeleteComplete={handleClearSelection}
          />
        }
      />
    </Stack>
  );
}
