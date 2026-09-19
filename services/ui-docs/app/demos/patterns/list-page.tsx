import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderRoot,
  AdaptiveHeaderTitle,
} from '@tale/ui/adaptive-header';
import { Badge } from '@tale/ui/badge';
import { ContentArea } from '@tale/ui/content-area';
import { DataTable } from '@tale/ui/data-table/data-table';
import { PageLayout } from '@tale/ui/page-layout';
import type { ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { useMemo, useState } from 'react';

interface Automation {
  id: string;
  name: string;
  trigger: string;
  state: 'on' | 'off';
}

const ROWS: Automation[] = [
  { id: '1', name: 'Weekly digest', trigger: 'Schedule', state: 'on' },
  { id: '2', name: 'Invoice intake', trigger: 'Webhook', state: 'on' },
  {
    id: '3',
    name: 'Escalate stale tickets',
    trigger: 'Schedule',
    state: 'off',
  },
];

const columns: ColumnDef<Automation>[] = [
  {
    accessorKey: 'name',
    header: 'Automation',
    cell: ({ row }) => <span className="font-medium">{row.original.name}</span>,
  },
  { accessorKey: 'trigger', header: 'Trigger' },
  {
    accessorKey: 'state',
    header: 'State',
    cell: ({ row }) => (
      <Badge dot variant={row.original.state === 'on' ? 'green' : 'slate'}>
        {row.original.state === 'on' ? 'Enabled' : 'Paused'}
      </Badge>
    ),
  },
];

/**
 * The whole list-page composition in one frame. Page chrome owns an `h1`, so
 * the example is presented as a labelled illustration — see the App shell
 * page for why.
 */
export default function PatternListPage() {
  const [query, setQuery] = useState('');
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return needle
      ? ROWS.filter((row) => row.name.toLowerCase().includes(needle))
      : ROWS;
  }, [query]);

  return (
    <div
      role="img"
      aria-label="A list page: header with a title, followed by a table toolbar with search and a create action above three automation rows."
      className="border-border bg-background w-full overflow-hidden rounded-lg border"
    >
      <div aria-hidden="true" inert className="flex h-96 flex-col">
        <AdaptiveHeaderProvider>
          <PageLayout
            header={
              <AdaptiveHeaderRoot showBorder standalone={false}>
                <AdaptiveHeaderTitle>Automations</AdaptiveHeaderTitle>
              </AdaptiveHeaderRoot>
            }
          >
            <ContentArea variant="list">
              <DataTable
                stickyLayout
                columns={columns}
                data={rows}
                caption="Automations"
                search={{
                  value: query,
                  onChange: setQuery,
                  placeholder: 'Search automations',
                }}
                addAction={{ label: 'New automation', icon: Plus }}
                emptyState={{ title: 'No automations yet' }}
              />
            </ContentArea>
          </PageLayout>
        </AdaptiveHeaderProvider>
      </div>
    </div>
  );
}
