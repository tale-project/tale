'use client';

import { Badge } from '@tale/ui/badge';
import type { ColumnDef } from '@tanstack/react-table';
import { Folder, Workflow } from 'lucide-react';
import { useMemo } from 'react';

import { Text } from '@/app/components/ui/typography/text';
import { useT } from '@/lib/i18n/client';

import { AutomationRowActions } from '../components/automation-row-actions';
import type { AutomationTableItem } from '../components/automations-table';

export function useAutomationsTableConfig(organizationId: string) {
  const { t: tTables } = useT('tables');
  const { t: tAutomations } = useT('automations');

  const columns = useMemo<ColumnDef<AutomationTableItem>[]>(
    () => [
      {
        id: 'name',
        header: tTables('headers.automation'),
        size: 300,
        meta: { hasAvatar: false },
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
        id: 'version',
        header: () => (
          <span className="block w-full text-right">
            {tTables('headers.version')}
          </span>
        ),
        size: 100,
        meta: { headerLabel: tTables('headers.version'), align: 'right' },
        cell: ({ row }) => {
          if (row.original.type === 'folder') {
            return (
              <Text as="span" variant="muted" className="block text-right">
                —
              </Text>
            );
          }
          return (
            <Text as="span" variant="caption" className="block text-right">
              {row.original.version}
            </Text>
          );
        },
      },
      {
        id: 'actions',
        size: 50,
        meta: { noTruncate: true },
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
    [tTables, organizationId],
  );

  return {
    columns,
    searchPlaceholder: tAutomations('search.placeholder'),
  };
}
