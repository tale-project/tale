'use client';

import { Badge } from '@tale/ui/badge';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Bot, Folder, Package } from 'lucide-react';
import { useMemo } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useT } from '@/lib/i18n/client';
import { displayCategoryI18nSuffix } from '@/lib/shared/agents/display-category';
import { stripModelRefQualifier } from '@/lib/shared/utils/model-ref';

import { AgentRowActions } from '../components/agent-row-actions';
import type { AgentTableItem } from '../components/agents-table';
import { folderLabel } from '../utils/folder-label';

interface AgentsTableConfig {
  columns: ColumnDef<AgentTableItem>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

interface AgentsTableConfigOptions {
  organizationId: string;
  teamNameMap: Map<string, string>;
  onDuplicated?: (newAgentName: string) => void;
  onDeleted?: () => void;
  /**
   * Prefix each agent's name with its folder path (e.g. "workforce / Analyst").
   * Used when the list is flattened across folders (search), so it stays clear
   * which folder a result belongs to.
   */
  showFolderPath?: boolean;
}

export function useAgentsTableConfig({
  organizationId,
  onDuplicated,
  onDeleted,
  showFolderPath = false,
}: AgentsTableConfigOptions): AgentsTableConfig {
  const { t } = useT('settings');
  // Folder rows show the same localized display name as the catalog's folder
  // sections, never the raw path segment (#2348).
  const { t: tCatalog } = useT('agentCatalog');
  const { t: tTables } = useT('tables');

  const columns = useMemo<ColumnDef<AgentTableItem>[]>(
    () => [
      // Multi-row select — canonical 40px column matching every other entity
      // table. The container gates `enableRowSelection` to non-protected agent
      // rows (folders + built-in agents can't be bulk-deleted).
      createSelectColumn<AgentTableItem>(),
      {
        id: 'displayName',
        header: t('agents.columns.displayName'),
        meta: { hasAvatar: false, skeleton: { type: 'icon-text' } },
        size: 250,
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            const isApp = row.original.appSlug !== undefined;
            return (
              <Row gap={3} className="min-h-8">
                {isApp ? (
                  <Package className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <Folder className="text-muted-foreground size-4 shrink-0" />
                )}
                <Text as="span" variant="label" truncate>
                  {folderLabel(tCatalog, row.original.name)}
                </Text>
                {isApp && <Badge variant="slate">{t('agents.appBadge')}</Badge>}
                <Badge variant="outline">{row.original.agentCount}</Badge>
              </Row>
            );
          }
          return (
            <Row gap={3} className="min-h-8">
              <Bot className="text-muted-foreground size-4 shrink-0" />
              <Text as="span" variant="label" truncate>
                {showFolderPath && row.original.folderPath ? (
                  <>
                    <span className="text-muted-foreground">
                      {row.original.folderPath} /{' '}
                    </span>
                    {row.original.displayName}
                  </>
                ) : (
                  row.original.displayName
                )}
              </Text>
            </Row>
          );
        },
      },
      {
        id: 'category',
        header: t('agents.columns.category'),
        meta: { skeleton: { type: 'badge' } },
        size: 140,
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          const category = row.original.displayCategory;
          if (!category) return null;
          const suffix = displayCategoryI18nSuffix(category);
          return (
            <Badge variant="outline">
              {t(`agents.form.displayCategory.${suffix}`)}
            </Badge>
          );
        },
      },
      {
        id: 'model',
        header: t('agents.columns.model'),
        meta: { skeleton: { type: 'badge' } },
        size: 200,
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          const model = row.original.supportedModels?.[0];
          if (!model) return null;
          return (
            <Badge variant="outline">{stripModelRefQualifier(model)}</Badge>
          );
        },
      },
      {
        id: 'tools',
        header: () => (
          <span className="block w-full text-right">
            {t('agents.columns.tools')}
          </span>
        ),
        size: 100,
        meta: { headerLabel: t('agents.columns.tools'), align: 'right' },
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          return (
            <Text as="span" variant="muted" className="block text-right">
              {row.original.toolNames?.length ?? 0}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        // sr-only label, matching `createActionsColumn` — an empty header cell
        // fails the axe `empty-table-header` audit.
        header: () => (
          <span className="sr-only">{tTables('headers.actions')}</span>
        ),
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          return (
            <HStack gap={1} justify="end">
              <AgentRowActions
                agentName={row.original.name}
                organizationId={organizationId}
                onDuplicated={onDuplicated}
                onDeleted={onDeleted}
                isAppOwned={row.original.appSlug !== undefined}
              />
            </HStack>
          );
        },
      },
    ],
    [
      t,
      tCatalog,
      tTables,
      organizationId,
      onDuplicated,
      onDeleted,
      showFolderPath,
    ],
  );

  return {
    columns,
    searchPlaceholder: t('agents.searchAgent'),
    stickyLayout: false,
    // Aligned to the shared default (was 50) so every entity table paginates
    // consistently. Agents lists are short enough that 20-per-page rarely
    // requires a "load more" click anyway.
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  };
}
