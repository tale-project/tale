'use client';

import { LinkButton } from '@tale/ui/button';
import { useQueryClient } from '@tanstack/react-query';
import { useNavigate } from '@tanstack/react-router';
import type { Row, RowSelectionState } from '@tanstack/react-table';
import { BarChart3, Bot, LayoutGrid, Network, Plus } from 'lucide-react';
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

import { useDeleteAgent } from '../hooks/mutations';
import { useListAgents } from '../hooks/queries';
import { useAgentsTableConfig } from '../hooks/use-agents-table-config';
import { AgentsActionMenu } from './agents-action-menu';

export interface AgentRow {
  name: string;
  displayName: string;
  description?: string;
  supportedModels?: string[];
  toolNames?: string[];
  visibleInChat?: boolean;
  roleRestriction?: string;
  status?: string;
  message?: string;
}

interface AgentsTableProps {
  organizationId: string;
}

export function AgentsTable({ organizationId }: AgentsTableProps) {
  const { t: tEmpty } = useT('emptyStates');
  const { t: tSettings } = useT('settings');
  const { t: tCatalog } = useT('agentCatalog');
  const { teams } = useTeamFilter();
  const navigate = useNavigate();
  const preloadRoute = usePreloadRoute();
  const queryClient = useQueryClient();
  const { agents: rawAgents, isLoading } = useListAgents(organizationId);
  const { i18n: i18nCtx } = useTranslation();
  const locale = i18nCtx.language;

  const agents = useMemo(() => {
    if (!rawAgents) return [];
    const validAgents: AgentRow[] = [];
    for (const a of rawAgents) {
      // Skip read errors surfaced by listAgents (they have `status`/`message`
      // instead of config fields).
      if (!a || typeof a.name !== 'string' || 'status' in a) continue;
      // System-managed agents (e.g. the Auto router) are not editable here.
      if (a.uiConfigurable === false) continue;
      const resolved = resolveAgentLocale(a, locale);
      if (!resolved.displayName) continue;
      validAgents.push({
        name: a.name,
        displayName: resolved.displayName,
        description: resolved.description,
        supportedModels: a.supportedModels,
        toolNames: a.toolNames,
        visibleInChat: a.visibleInChat,
        roleRestriction: a.roleRestriction,
      });
    }
    return validAgents;
  }, [rawAgents, locale]);

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
    const map = new Map();
    if (teams) {
      for (const team of teams) {
        map.set(team.id, team.name);
      }
    }
    return map;
  }, [teams]);

  const { columns, searchPlaceholder, stickyLayout, pageSize } =
    useAgentsTableConfig({
      organizationId,
      teamNameMap,
      onDuplicated: handleDuplicated,
      onDeleted: invalidateAgents,
    });

  const handleRowClick = useCallback(
    (row: Row<AgentRow>) => {
      void navigate({
        to: '/dashboard/$id/agents/$agentId',
        params: {
          id: organizationId,
          agentId: row.original.name,
        },
      });
    },
    [navigate, organizationId],
  );

  const handleRowMouseEnter = useCallback(
    (row: Row<AgentRow>) => {
      // Warm the detail route (runs its loader → readAgent) on hover so the
      // click lands on already-fetched data.
      preloadRoute({
        to: '/dashboard/$id/agents/$agentId',
        params: { id: organizationId, agentId: row.original.name },
      });
    },
    [preloadRoute, organizationId],
  );

  const list = useListPage<AgentRow>({
    dataSource: {
      type: 'query',
      data: isLoading ? undefined : agents,
    },
    pageSize,
    search: {
      fields: ['displayName', 'name'],
      placeholder: searchPlaceholder,
    },
    entityLabel: tSettings('agents.entityLabel'),
  });

  return (
    <DataTable
      className="p-4"
      {...list.tableProps}
      columns={columns}
      stickyLayout={stickyLayout}
      // Built-in agents are not deletable, so they aren't selectable either —
      // the header checkbox + bulk bar only ever target user-created agents.
      enableRowSelection={(row) =>
        !PROTECTED_AGENT_NAMES.some((name) => name === row.original.name)
      }
      rowSelection={rowSelection}
      onRowSelectionChange={setRowSelection}
      // Agents are keyed by `name`; pin the row id so the bulk handler receives
      // the same string the delete mutation expects.
      getRowId={(row) => row.name}
      rowClassName={(row) =>
        row.original.name === highlightedName
          ? 'bg-primary/10 transition-colors duration-500 motion-reduce:transition-none'
          : ''
      }
      onRowClick={handleRowClick}
      onRowMouseEnter={handleRowMouseEnter}
      actionMenu={
        <div className="flex items-center gap-2">
          {/* Standalone entries — same pattern as the automations list's
              Metrics button — so each chart is one click away, not buried
              in the create menu. */}
          <LinkButton
            href="/dashboard/$id/agents/metrics"
            params={{ id: organizationId }}
            variant="secondary"
            icon={BarChart3}
          >
            {tSettings('agents.metrics.link')}
          </LinkButton>
          <LinkButton
            href="/dashboard/$id/agents/organigram"
            params={{ id: organizationId }}
            variant="secondary"
            icon={Network}
          >
            {tSettings('agents.organigram.menuItem')}
          </LinkButton>
          <LinkButton
            href="/dashboard/$id/agents/catalog"
            params={{ id: organizationId }}
            variant="secondary"
            icon={LayoutGrid}
          >
            {tCatalog('menuItem')}
          </LinkButton>
          <AgentsActionMenu
            organizationId={organizationId}
            createOpen={createOpen}
            onCreateOpenChange={setCreateOpen}
          />
        </div>
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
