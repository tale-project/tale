'use client';

import { useMemo } from 'react';
import { useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { DataTable, DataTableEmptyState } from '@/components/ui/data-table';
import { Button } from '@/components/ui/button';
import { IconButton } from '@/components/ui/icon-button';
import { Stack, HStack } from '@/components/ui/layout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  Eye,
  Pencil,
  Trash2,
  Plus,
  Sparkles,
  MoreVertical,
} from 'lucide-react';
import { formatDate } from '@/lib/utils/date/format';
import Pagination from '@/components/ui/pagination';
import { useT, useLocale } from '@/lib/i18n';

interface ExampleMessage {
  id: string;
  content: string;
  updatedAt: Date;
}

interface ExampleMessagesTableProps {
  examples: ExampleMessage[];
  onAddExample: () => void;
  onViewExample: (example: ExampleMessage) => void;
  onEditExample: (example: ExampleMessage) => void;
  onDeleteExample: (exampleId: string) => Promise<void>;
}

const truncateMessage = (message: string, maxLength: number = 100) => {
  if (message.length <= maxLength) return message;
  return `"${message.substring(0, maxLength)}..."`;
};

export default function ExampleMessagesTable({
  examples,
  onAddExample,
  onViewExample,
  onEditExample,
  onDeleteExample,
}: ExampleMessagesTableProps) {
  const { t: tCommon } = useT('common');
  const { t: tTone } = useT('toneOfVoice');
  const { t: tTables } = useT('tables');
  const { t: tEmpty } = useT('emptyStates');
  const locale = useLocale();
  const searchParams = useSearchParams();
  const itemsPerPage = 5;

  // Get current page from URL query params, default to 1
  const currentPage = parseInt(searchParams.get('page') || '1', 10);

  // Calculate pagination
  const totalPages = Math.ceil(examples.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedExamples = examples.slice(startIndex, endIndex);
  const hasNextPage = currentPage < totalPages;

  // Column definitions
  const columns = useMemo<ColumnDef<ExampleMessage>[]>(
    () => [
      {
        accessorKey: 'content',
        header: tTables('headers.message'),
        cell: ({ row }) => (
          <span className="text-sm font-medium text-foreground">
            {truncateMessage(row.original.content)}
          </span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: tTables('headers.updated'),
        size: 140,
        cell: ({ row }) => (
          <span className="text-xs text-muted-foreground tracking-[-0.072px]">
            {formatDate(row.original.updatedAt, { customFormat: 'YYYY-MM-DD', locale })}
          </span>
        ),
      },
      {
        id: 'actions',
        size: 60,
        cell: ({ row }) => (
          <HStack justify="end">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <IconButton
                  icon={MoreVertical}
                  aria-label={tTables('headers.actions')}
                  className="size-8"
                />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onClick={() => onViewExample(row.original)}>
                  <Eye className="size-4 mr-2" />
                  {tCommon('actions.view')}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => onEditExample(row.original)}>
                  <Pencil className="size-4 mr-2" />
                  {tCommon('actions.edit')}
                </DropdownMenuItem>
                <DropdownMenuItem
                  onClick={() => onDeleteExample(row.original.id)}
                  className="text-destructive focus:text-destructive"
                >
                  <Trash2 className="size-4 mr-2" />
                  {tCommon('actions.delete')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </HStack>
        ),
      },
    ],
    [tTables, tCommon, onViewExample, onEditExample, onDeleteExample],
  );

  // Header component
  const header = (
    <HStack justify="between">
      <Stack gap={1}>
        <h3 className="text-lg font-semibold text-foreground tracking-[-0.096px]">
          {tTone('exampleMessages.title')}
        </h3>
        <p className="text-sm text-muted-foreground tracking-[-0.084px]">
          {tTone('exampleMessages.description')}
        </p>
      </Stack>
      {examples.length > 0 && (
        <Button onClick={onAddExample}>
          <Plus className="size-4 mr-2" />
          {tTone('exampleMessages.addButton')}
        </Button>
      )}
    </HStack>
  );

  // Empty state
  if (examples.length === 0) {
    return (
      <Stack gap={5}>
        {header}
        <DataTableEmptyState
          icon={Sparkles}
          title={tEmpty('examples.title')}
          description={tEmpty('examples.description')}
          action={
            <Button onClick={onAddExample}>
              <Plus className="size-4 mr-2" />
              {tTone('exampleMessages.addButton')}
            </Button>
          }
        />
      </Stack>
    );
  }

  return (
    <Stack gap={5}>
      {header}
      <DataTable
        columns={columns}
        data={paginatedExamples}
        getRowId={(row) => row.id}
        footer={
          examples.length > itemsPerPage ? (
            <Pagination
              currentPage={currentPage}
              total={examples.length}
              pageSize={itemsPerPage}
              totalPages={totalPages}
              hasNextPage={hasNextPage}
            />
          ) : undefined
        }
      />
    </Stack>
  );
}
