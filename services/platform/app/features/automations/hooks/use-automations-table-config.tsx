'use client';

import { Badge } from '@tale/ui/badge';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { Folder, Package, Workflow } from 'lucide-react';
import { useMemo } from 'react';

import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { AutomationRowActions } from '../components/automation-row-actions';
import type { AutomationTableItem } from '../components/automations-table';

interface AutomationsTableConfigOptions {
  /**
   * Prefix each workflow's name with its folder path (e.g. "github / GitHub
   * Issue Sync"). Used when the list is flattened across folders (search), so
   * it stays clear which folder a result belongs to.
   */
  showFolderPath?: boolean;
}

export function useAutomationsTableConfig(
  organizationId: string,
  { showFolderPath = false }: AutomationsTableConfigOptions = {},
) {
  const { t: tTables } = useT('tables');
  const { t: tAutomations } = useT('automations');
  const { formatDate } = useFormatDate();

  const columns = useMemo<ColumnDef<AutomationTableItem>[]>(
    () => [
      // Multi-row select — canonical 40px column. The container table gates
      // `enableRowSelection` to only workflow rows (not folder aggregates),
      // so the checkbox in folder rows renders disabled.
      createSelectColumn<AutomationTableItem>(),
      {
        id: 'name',
        header: tTables('headers.automation'),
        size: 300,
        meta: { hasAvatar: false, skeleton: { type: 'icon-text' } },
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
                  {row.original.name}
                </Text>
                {isApp && (
                  <Badge variant="slate">{tAutomations('appBadge')}</Badge>
                )}
                <Badge variant="outline">{row.original.workflowCount}</Badge>
              </Row>
            );
          }
          return (
            <Row gap={3} className="min-h-8">
              <Workflow className="text-muted-foreground size-4 shrink-0" />
              <Text as="span" variant="label" truncate>
                {showFolderPath && row.original.folderPath ? (
                  <>
                    <span className="text-muted-foreground">
                      {row.original.folderPath} /{' '}
                    </span>
                    {row.original.name}
                  </>
                ) : (
                  row.original.name
                )}
              </Text>
            </Row>
          );
        },
      },
      {
        id: 'created',
        header: tTables('headers.created'),
        size: 140,
        meta: { headerLabel: tTables('headers.created') },
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return (
              <Text as="span" variant="muted">
                —
              </Text>
            );
          }
          const ms = row.original.createdAtMs;
          return (
            <Text as="span" variant="caption">
              {ms !== undefined ? formatDate(new Date(ms), 'medium') : '—'}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        header: () => null,
        meta: {
          noTruncate: true,
          isAction: true,
          skeleton: { type: 'action' },
        },
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          return (
            <Row
              gap={0}
              align="stretch"
              justify="end"
              role="presentation"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
            >
              <AutomationRowActions
                organizationId={organizationId}
                automation={{
                  _id: row.original.slug,
                  name: row.original.name,
                }}
                isAppOwned={row.original.appSlug !== undefined}
              />
            </Row>
          );
        },
      },
    ],
    [tTables, tAutomations, organizationId, formatDate, showFolderPath],
  );

  return {
    columns,
    searchPlaceholder: tAutomations('search.placeholder'),
  };
}
