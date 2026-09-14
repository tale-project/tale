import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import type { ColumnDef } from '@tanstack/react-table';

interface Agent {
  id: string;
  name: string;
  model: string;
  status: 'ready' | 'draft';
}

const AGENTS: Agent[] = [
  { id: '1', name: 'Support triage', model: 'claude-sonnet', status: 'ready' },
  { id: '2', name: 'Invoice reader', model: 'gpt-4.1-mini', status: 'ready' },
  { id: '3', name: 'Release notes', model: 'llama-3.3-70b', status: 'draft' },
];

const columns: ColumnDef<Agent>[] = [
  {
    accessorKey: 'name',
    header: 'Agent',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  { accessorKey: 'model', header: 'Model' },
  {
    accessorKey: 'status',
    header: 'Status',
    cell: ({ row }) => (
      <Badge dot variant={row.original.status === 'ready' ? 'green' : 'slate'}>
        {row.original.status === 'ready' ? 'Ready' : 'Draft'}
      </Badge>
    ),
  },
];

export default function DataTableBasic() {
  return (
    <div className="w-full">
      <DataTable
        columns={columns}
        data={AGENTS}
        caption="Agents in this workspace"
      />
    </div>
  );
}
