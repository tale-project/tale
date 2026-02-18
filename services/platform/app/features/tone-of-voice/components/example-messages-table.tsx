'use client';

import { useSearch } from '@tanstack/react-router';
import { type ColumnDef } from '@tanstack/react-table';
import {
  Eye,
  Pencil,
  Trash2,
  Plus,
  Sparkles,
  MoreVertical,
} from 'lucide-react';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import { DataTable } from '@/app/components/ui/data-table/data-table';
import { DataTableActionMenu } from '@/app/components/ui/data-table/data-table-action-menu';
import { DataTableEmptyState } from '@/app/components/ui/data-table/data-table-empty-state';
import { HStack } from '@/app/components/ui/layout/layout';
import { PageSection } from '@/app/components/ui/layout/page-section';
import { Pagination } from '@/app/components/ui/navigation/pagination';
import { DropdownMenu } from '@/app/components/ui/overlays/dropdown-menu';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { useT } from '@/lib/i18n/client';

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
  return `"${message.slice(0, maxLength)}..."`;
};

export function ExampleMessagesTable({
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
  const search = useSearch({ strict: false });
  const itemsPerPage = 5;

  // Get current page from URL query params, default to 1
  const currentPage = parseInt(search.page || '1', 10);

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
          <span className="text-foreground text-sm font-medium">
            {truncateMessage(row.original.content)}
          </span>
        ),
      },
      {
        accessorKey: 'updatedAt',
        header: () => (
          <span className="block w-full text-right">
            {tTables('headers.updated')}
          </span>
        ),
        size: 140,
        meta: { headerLabel: tTables('headers.updated') },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.updatedAt}
            preset="short"
            alignRight
          />
        ),
      },
      {
        id: 'actions',
        size: 60,
        cell: ({ row }) => (
          <HStack justify="end">
            <DropdownMenu
              trigger={
                <IconButton
                  icon={MoreVertical}
                  aria-label={tTables('headers.actions')}
                  className="size-8"
                />
              }
              items={[
                [
                  {
                    type: 'item',
                    label: tCommon('actions.view'),
                    icon: Eye,
                    onClick: () => onViewExample(row.original),
                  },
                  {
                    type: 'item',
                    label: tCommon('actions.edit'),
                    icon: Pencil,
                    onClick: () => onEditExample(row.original),
                  },
                  {
                    type: 'item',
                    label: tCommon('actions.delete'),
                    icon: Trash2,
                    destructive: true,
                    onClick: () => onDeleteExample(row.original.id),
                  },
                ],
              ]}
              align="end"
            />
          </HStack>
        ),
      },
    ],
    // locale is not used in column definitions
    [tTables, tCommon, onViewExample, onEditExample, onDeleteExample],
  );

  const action =
    examples.length > 0 ? (
      <Button onClick={onAddExample}>
        <Plus className="mr-2 size-4" />
        {tTone('exampleMessages.addButton')}
      </Button>
    ) : undefined;

  if (examples.length === 0) {
    return (
      <PageSection
        as="h3"
        titleSize="lg"
        title={tTone('exampleMessages.title')}
        description={tTone('exampleMessages.description')}
        gap={5}
      >
        <DataTableEmptyState
          icon={Sparkles}
          title={tEmpty('examples.title')}
          description={tEmpty('examples.description')}
          actionMenu={
            <DataTableActionMenu
              label={tTone('exampleMessages.addButton')}
              icon={Plus}
              onClick={onAddExample}
            />
          }
        />
      </PageSection>
    );
  }

  return (
    <PageSection
      as="h3"
      titleSize="lg"
      title={tTone('exampleMessages.title')}
      description={tTone('exampleMessages.description')}
      action={action}
      gap={5}
    >
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
    </PageSection>
  );
}
