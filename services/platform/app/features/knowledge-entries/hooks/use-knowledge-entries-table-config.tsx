'use client';

import { Badge } from '@tale/ui/badge';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { useMemo } from 'react';

import { CopyableTimestamp } from '@/app/components/ui/data-display/copyable-timestamp';
import {
  ACTIONS_COLUMN_SIZE,
  createActionsColumn,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { RagStatusBadge } from '@/app/features/documents/components/rag-status-badge';
import { DEFAULT_TABLE_PAGE_SIZE } from '@/app/hooks/use-table-config-factory';
import { useT } from '@/lib/i18n/client';

import { KnowledgeEntryRowActions } from '../components/knowledge-entry-row-actions';
import type { KnowledgeEntryItem } from './queries';

interface KnowledgeEntriesTableConfig {
  columns: ColumnDef<KnowledgeEntryItem>[];
  searchPlaceholder: string;
  stickyLayout: boolean;
  pageSize: number;
}

export function useKnowledgeEntriesTableConfig(): KnowledgeEntriesTableConfig {
  const { t: tTables } = useT('tables');
  const { t: tEntity } = useT('knowledgeEntries');

  const columns = useMemo<ColumnDef<KnowledgeEntryItem>[]>(
    () => [
      createSelectColumn<KnowledgeEntryItem>(),
      {
        accessorKey: 'topic',
        header: tEntity('headers.topic'),
        size: 240,
        cell: ({ row }) => (
          <HStack gap={2}>
            <Row
              gap={0}
              justify="center"
              className="bg-muted size-5 shrink-0 rounded"
            >
              <BookOpen className="text-muted-foreground size-3" />
            </Row>
            <Text as="span" variant="label" truncate>
              {row.original.topic}
            </Text>
          </HStack>
        ),
      },
      {
        accessorKey: 'content',
        header: tEntity('headers.content'),
        cell: ({ row }) => (
          <Text
            as="span"
            variant="caption"
            truncate
            className="block max-w-[28rem]"
          >
            {row.original.content}
          </Text>
        ),
      },
      {
        accessorKey: 'source',
        header: tEntity('headers.source'),
        size: 96,
        cell: ({ row }) => (
          <Badge variant="outline">
            {row.original.source === 'chat'
              ? tEntity('source.chat')
              : tEntity('source.manual')}
          </Badge>
        ),
      },
      {
        id: 'ragStatus',
        header: tTables('headers.status'),
        size: 128,
        meta: { headerLabel: tTables('headers.status') },
        cell: ({ row }) => (
          <RagStatusBadge
            status={row.original.ragStatus}
            indexedAt={row.original.ragIndexedAt}
            error={row.original.ragError}
            documentId={
              row.original.documentId
                ? String(row.original.documentId)
                : undefined
            }
          />
        ),
      },
      {
        accessorKey: 'createdAt',
        header: () => (
          <span className="block w-full text-right">
            {tEntity('headers.updated')}
          </span>
        ),
        size: 128,
        meta: { headerLabel: tEntity('headers.updated') },
        cell: ({ row }) => (
          <CopyableTimestamp
            date={row.original.createdAt}
            preset="long"
            alignRight
          />
        ),
      },
      createActionsColumn(KnowledgeEntryRowActions, 'entry', {
        size: ACTIONS_COLUMN_SIZE,
        headerLabel: tTables('headers.actions'),
      }),
    ],
    [tTables, tEntity],
  );

  return {
    columns,
    searchPlaceholder: tEntity('searchPlaceholder'),
    stickyLayout: true,
    pageSize: DEFAULT_TABLE_PAGE_SIZE,
  };
}
