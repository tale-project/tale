'use client';

import { Badge } from '@/app/components/ui/feedback/badge';
import { AutomationRowActions } from './automation-row-actions';
import { createTableConfigHook } from '@/app/hooks/use-table-config-factory';

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
        <span className="text-sm font-medium text-foreground truncate px-2">
          {row.original.name}
        </span>
      ),
    },
    {
      accessorKey: 'status',
      header: () => tTables('headers.status'),
      size: 140,
      cell: ({ row }) => (
        <Badge
          dot
          variant={row.original.status === 'active' ? 'green' : 'outline'}
        >
          {row.original.status === 'active'
            ? t.common('status.published')
            : t.common('status.draft')}
        </Badge>
      ),
    },
    {
      accessorKey: 'version',
      header: () => (
        <span className="text-right w-full block">
          {tTables('headers.version')}
        </span>
      ),
      size: 100,
      cell: ({ row }) => (
        <span className="text-xs text-muted-foreground text-right block">
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
