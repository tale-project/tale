'use client';

import { Badge } from '@/app/components/ui/feedback/badge';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

import { AutomationRowActions } from './automation-row-actions';

export const useAutomationsTableConfig = createTableConfigHook<'wfDefinitions'>(
  {
    entityNamespace: 'automations',
    additionalNamespaces: ['common'],
    defaultSort: '_creationTime',
  },
  ({ tTables, t, builders }) => [
    {
      accessorKey: 'name',
      header: () => tTables('headers.automation'),
      size: 328,
      cell: ({ row }) => (
        <span className="text-foreground truncate px-2 text-sm font-medium">
          {row.original.name}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: () => tTables('headers.status'),
      size: 140,
      cell: ({ row }) => {
        const status = row.original.status;
        return (
          <Badge dot variant={status === 'active' ? 'green' : 'outline'}>
            {status === 'active'
              ? t.common('status.published')
              : status === 'archived'
                ? t.common('status.archived')
                : t.common('status.draft')}
          </Badge>
        );
      },
    },
    {
      accessorKey: 'version',
      header: () => (
        <span className="block w-full text-right">
          {tTables('headers.version')}
        </span>
      ),
      size: 100,
      cell: ({ row }) => (
        <span className="text-muted-foreground block text-right text-xs">
          {row.original.version}
        </span>
      ),
    },
    builders.createCreationTimeColumn(tTables),
    builders.createActionsColumn(AutomationRowActions, 'automation', {
      size: 80,
    }),
  ],
);
