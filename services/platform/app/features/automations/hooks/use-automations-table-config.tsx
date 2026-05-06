'use client';

import { Badge } from '@tale/ui/badge';
import type { ColumnDef } from '@tanstack/react-table';
import { Folder, Workflow } from 'lucide-react';
import { useMemo } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { useFormatDate } from '@/app/hooks/use-format-date';
import { useT } from '@/lib/i18n/client';

import { AutomationRowActions } from '../components/automation-row-actions';
import type { AutomationTableItem } from '../components/automations-table';

export function useAutomationsTableConfig(organizationId: string) {
  const { t: tTables } = useT('tables');
  const { t: tAutomations } = useT('automations');
  const { formatDate } = useFormatDate();

  const columns = useMemo<ColumnDef<AutomationTableItem>[]>(
    () => [
      {
        id: 'name',
        header: tTables('headers.automation'),
        size: 300,
        meta: { hasAvatar: false, skeleton: { type: 'icon-text' } },
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return (
              <div className="flex items-center gap-3">
                <Folder className="text-muted-foreground size-4 shrink-0" />
                <Text as="span" variant="label" truncate>
                  {row.original.name}
                </Text>
                <Badge variant="outline">{row.original.workflowCount}</Badge>
              </div>
            );
          }
          return (
            <div className="flex items-center gap-3">
              <Workflow className="text-muted-foreground size-4 shrink-0" />
              <Text as="span" variant="label" truncate>
                {row.original.name}
              </Text>
            </div>
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
              {ms ? formatDate(new Date(ms), 'medium') : '—'}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        size: 50,
        header: () => null,
        meta: {
          noTruncate: true,
          isAction: true,
          skeleton: { type: 'action' },
        },
        cell: ({ row }) => {
          if (row.original.type === 'folder') return null;
          return (
            <div
              className="flex justify-end"
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
              />
            </div>
          );
        },
      },
    ],
    [tTables, organizationId, formatDate],
  );

  return {
    columns,
    searchPlaceholder: tAutomations('search.placeholder'),
  };
}
