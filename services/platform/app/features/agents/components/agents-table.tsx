'use client';

import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { Bot, Plus } from 'lucide-react';
import { useMemo, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DataTable } from '@/app/components/ui/data-table/data-table';
import { BulkDeleteBar } from '@/app/components/ui/data-table/data-table-bulk-actions';
import { useListPage } from '@/app/hooks/use-list-page';
import { usePreloadRoute } from '@/app/hooks/use-preload-route';
import { useTeamFilter } from '@/app/hooks/use-team-filter';
import { useT } from '@/lib/i18n/client';
import { PROTECTED_AGENT_NAMES } from '@/lib/shared/constants/agents';
import { resolveAgentLocale } from '@/lib/shared/utils/resolve-agent-locale';
import { buildFolderView, isInFolder } from '@/lib/utils/folder-tree';

import { useDeleteAgent } from '../hooks/mutations';
import { useListAgents } from '../hooks/queries';
import { useAgentsTableConfig } from '../hooks/use-agents-table-config';
import { toConfigurableAgent } from '../utils/agent-list-item';
import { AgentsActionMenu } from './agents-action-menu';

export interface AgentRow {
  type: 'agent';
  name: string;
  displayName: string;
  description?: string;
  /** '/'-joined folder path the agent lives in (from its `folder` field). */
  folderPath: string;
  supportedModels?: string[];
  toolNames?: string[];
  visibleInChat?: boolean;
  roleRestriction?: string;
  status?: string;
  message?: string;
}

export interface AgentFolderItem {
  type: 'folder';
  /** Last path segment — the folder's display name. */
  name: string;
  /** Full '/'-joined path used to drill in. */
  path: string;
  agentCount: number;
}

export type AgentTableItem = AgentRow | AgentFolderItem;

interface AgentsTableProps {
  organizationId: string;
  currentFolder?: string;
}

export function AgentsTable({
  organizationId,
  currentFolder,
}: AgentsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tSettings } = useT('settings');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const queryClient = useQueryClient();
  const { agents: rawAgents, isLoading } = useListAgents(organizationId);
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;
  const [searchQuery, setSearchQuery] = useState('');
  const isSearching = searchQuery.trim().length > 0;

  const agents = useMemo<AgentRow[]>(() => {
    if (!rawAgents) return [];
    const validAgents: AgentRow[] = [];
    for (const raw of rawAgents) {
      // Drops read-error rows + system-managed agents (the Auto router etc.).
      const agent = toConfigurableAgent(raw);
      if (!agent) continue;
      const resolved = resolveAgentLocale(agent, locale);
      if (!resolved.displayName) continue;
      validAgents.push({
        type: 'agent',
        name: agent.name,
        displayName: resolved.displayName,
        description: resolved.description,
        folderPath: agent.folder ?? '',
        supportedModels: agent.supportedModels,
        toolNames: agent.toolNames,
        visibleInChat: agent.visibleInChat,
        roleRestriction: agent.roleRestriction,
      });
    }
    return validAgents;
  }, [rawAgents, locale]);

  // Search is global (matches across every folder); otherwise scope to the
  // current folder plus everything nested beneath it.
  const scopedAgents = useMemo<AgentRow[]>(() => {
    if (isSearching) {
      const q = searchQuery.toLowerCase().trim();
      return agents.filter(
        (a) =>
          a.displayName.toLowerCase().includes(q) ||
          a.name.toLowerCase().includes(q) ||
          a.folderPath.toLowerCase().includes(q),
      );
    }
    return agents.filter((a) => isInFolder(a.folderPath, currentFolder ?? ''));
  }, [agents, searchQuery, isSearching, currentFolder]);

  const tableItems = useMemo<AgentTableItem[]>(() => {
    // While searching, the list is flat across folders (folder rows are dropped;
    // each result shows its folder path prefix via the config).
    if (isSearching) {
      return [...scopedAgents].sort((a, b) =>
        a.displayName.localeCompare(b.displayName),
      );
    }
    // Otherwise: this folder's immediate child folders, then its direct agents.
    const { subfolders, items } = buildFolderView(
      scopedAgents,
      (a) => a.folderPath,
      currentFolder ?? '',
    );
    const folderItems: AgentFolderItem[] = subfolders.map((f) => ({
      type: 'folder',
      name: f.name,
      path: f.path,
      agentCount: f.count,
    }));
    const agentItems = [...items].sort((a, b) =>
      a.displayName.localeCompare(b.displayName),
    );
    return [...folderItems, ...agentItems];
  }, [scopedAgents, isSearching, currentFolder]);

  const { mutateAsync: deleteAgent } = useDeleteAgent();
  const [rowSelection, setRowSelection] = useState<RowSelectionState>({});
  // Lifted so both the action menu and the empty-state CTA open the one dialog.
  const [createOpen, setCreateOpen] = useState(false);

  const invalidateAgents = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['config', 'agents'] });
  }, [queryClient]);

  const handleClearSelection = useCallback(() => {
    setRowSelection({});
  }, []);

  const handleBulkDeleteItem = useCallback(
    // Per-row delete reuses the same mutation as the single-row dialog so
    // server-side handling stays consistent. The bar surfaces one batch toast.
    async (agentName: string) => {
      await deleteAgent({ organizationId, agentName });
    },
    [deleteAgent, organizationId],
  );

  // Briefly highlight a freshly-duplicated row so it reads as a new, separate
  // agent in the list rather than something tied to the menu it came from
  // (#1354).
  const [highlightedName, setHighlightedName] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    },
    [],
  );

  const handleDuplicated = useCallback(
    (newAgentName: string) => {
      invalidateAgents();
      setHighlightedName(newAgentName);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightedName(null), 2500);
    },
    [invalidateAgents],
  );

  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    for (const team of teams ?? []) {
      map.set(team.id, team.name);
    }
    return map;
  }, [teams]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAgentsTableConfig({
      organizationId,
      teamNameMap,
      onDuplicated: handleDuplicated,
      onDeleted: invalidateAgents,
      showFolderPath: isSearching,
    });

  const handleRowClick = useCallback(
    (row: Row<AgentTableItem>) => {
      const item = row.original;
      if (item.type === 'folder') {
        void navigate({
          to: '/dashboard/$id/agents/all',
          params: { id: organizationId },
          search: { folder: item.path },
        });
        return;
      }
      void navigate({
        to: '/dashboard/$id/agents/$agentId',
        params: { id: organizationId, agentId: item.name },
      });
    },
    [navigate, organizationId],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<AgentTableItem>) => {
      if (row.original.type !== 'agent') return;
      // Warm the detail route (runs its loader → readAgent) on hover so the
      // click lands on already-fetched data.
      preloadRoute({
        to: '/dashboard/$id/agents/$agentId',
        params: { id: organizationId, agentId: row.original.name },
      });
    },
    [preloadRoute, organizationId],
  );

  // Controlled search: we compute folder grouping + global search in
  // `tableItems` ourselves, so `useListPage` only renders the search box and
  // paginates (it doesn't re-filter the controlled value).
  const list = useListPage<AgentTableItem>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : tableItems,
    },
    pageSize,
    search: {
      value: searchQuery,
      onChange: setSearchQuery,
      placeholder: searchPlaceholder,
    },
    getRowId: (row) => (row.type === 'agent' ? row.name : `folder:${row.path}`),
    entityLabel: tSettings('agents.entityLabel'),
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      // Folders aren't selectable, and built-in agents are not deletable — so
      // the header checkbox + bulk bar only ever target user-created agents.
      enableRowSelection={(row) =>
        row.original.type === 'agent' &&
        !PROTECTED_AGENT_NAMES.some((name) => name === row.original.name)
      }
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      rowClassName={(row) => {
        if (row.original.type === 'folder') return 'cursor-pointer';
        return row.original.name === highlightedName
          ? 'bg-primary/10 transition-colors duration-500 motion-reduce:transition-none'
          : '';
      }}
      onRowClick={handleRowClick}
      onRowMouseEnter={handleRowMouseEnter}
      actionMenu={
        // Overview / Catalog / Metrics live in the agents-page tab strip
        // (agents.tsx); this list carries only the create action.
        <AgentsActionMenu
          organizationId={organizationId}
          createOpen={createOpen}
          onCreateOpenChange={setCreateOpen}
        />
      }
      emptyState={{
        icon: Bot,
        title: tEmpty('agents.title'),
        description: tEmpty('agents.description'),
        action: {
          label: tSettings('agents.createAgent'),
          icon: Plus,
          onClick: () => setCreateOpen(true),
        },
      }}
      footer={
        <BulkDeleteBar
          rowSelection={rowSelection}
          onClearSelection={handleClearSelection}
          onDeleteItem={handleBulkDeleteItem}
          onDeleteComplete={() => {
            handleClearSelection();
            invalidateAgents();
          }}
        />
      }
    />
  );
}
