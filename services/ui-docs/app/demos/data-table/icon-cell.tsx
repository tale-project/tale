import { Badge } from '@tale/ui/badge';
import { DataTable } from '@tale/ui/data-table/data-table';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen, Globe, Workflow } from 'lucide-react';

interface Entry {
  id: string;
  name: string;
  slug?: string;
  kind?: string;
  icon: 'entry' | 'website' | 'automation';
  updated: string;
}

const GLYPHS = {
  entry: <BookOpen />,
  website: <Globe />,
  automation: <Workflow />,
} as const;

const ENTRIES: Entry[] = [
  {
    id: '1',
    name: 'Refund policy',
    icon: 'entry',
    updated: 'Mar 4, 2025',
  },
  {
    id: '2',
    name: 'tale.dev',
    icon: 'website',
    kind: 'List',
    updated: 'Mar 2, 2025',
  },
  {
    id: '3',
    name: 'Triage the inbox',
    slug: 'gmail/triage-inbox',
    icon: 'automation',
    updated: 'Feb 27, 2025',
  },
];

const columns: ColumnDef<Entry>[] = [
  {
    accessorKey: 'name',
    header: 'Name',
    size: 240,
    meta: { flex: true, skeleton: tableIconCellSkeleton({ lines: 2 }) },
    cell: ({ row }) => (
      <TableIconCell
        icon={GLYPHS[row.original.icon]}
        label={row.original.name}
        badges={
          row.original.kind ? (
            <Badge variant="outline" className="shrink-0">
              {row.original.kind}
            </Badge>
          ) : null
        }
        caption={row.original.slug}
      />
    ),
  },
  { accessorKey: 'updated', header: 'Updated', size: 120 },
];

export default function DataTableIconCell() {
  return (
    <div className="w-full">
      <DataTable columns={columns} data={ENTRIES} caption="Knowledge" />
    </div>
  );
}
