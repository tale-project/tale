import { DataTable } from '@tale/ui/data-table/data-table';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo, useState } from 'react';

interface Automation {
  id: string;
  name: string;
  trigger: string;
}

const AUTOMATIONS: Automation[] = [
  { id: '1', name: 'Weekly digest', trigger: 'Schedule' },
  { id: '2', name: 'Invoice intake', trigger: 'Webhook' },
  { id: '3', name: 'Escalate stale tickets', trigger: 'Schedule' },
  { id: '4', name: 'Publish release notes', trigger: 'Manual' },
];

const columns: ColumnDef<Automation>[] = [
  {
    accessorKey: 'name',
    header: 'Automation',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  { accessorKey: 'trigger', header: 'Trigger' },
];

export default function DataTableWithSearch() {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return AUTOMATIONS;
    return AUTOMATIONS.filter((row) => row.name.toLowerCase().includes(needle));
  }, [query]);

  return (
    <div className="w-full">
      <DataTable
        columns={columns}
        data={rows}
        caption="Automations"
        search={{
          value: query,
          onChange: setQuery,
          placeholder: 'Search automations',
        }}
        emptyState={{ title: 'No automation matches that search' }}
      />
    </div>
  );
}
