'use client';

import { Badge } from '@tale/ui/badge';
import { CopyableTimestamp } from '@tale/ui/copyable-timestamp';
import {
  ACTIONS_COLUMN_SIZE,
  createActionsColumn,
  createSelectColumn,
} from '@tale/ui/data-table/column-builders';
import { HStack, Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { useMemo } from 'react';

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
        meta: {
          flex: true,
          skeleton: {
            type: 'icon-text',
            icon: <BookOpen className="size-5" />,
          },
        },
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
        size: 280,
        meta: { className: 'overflow-hidden' },
        cell: ({ row }) => (
          <div className="w-0 min-w-full overflow-hidden">
            <Text
              as="span"
              variant="caption"
              truncate
              title={row.original.content}
              className="block"
            >
              {row.original.content}
            </Text>
          </div>
        ),
      },
      {
        accessorKey: 'source',
        header: tEntity('headers.source'),
        size: 96,
        meta: { skeleton: { type: 'badge' } },
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
        meta: {
          headerLabel: tTables('headers.status'),
          skeleton: { type: 'badge', badge: { variant: 'blue' } },
          className: 'overflow-hidden',
        },
        cell: ({ row }) => (
          <RagStatusBadge
            status={row.original.ragStatus}
            indexedAt={row.original.ragIndexedAt}
            error={row.original.ragError}
            errorCode={row.original.ragErrorCode}
            documentId={
              row.original.documentId ? row.original.documentId : undefined
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
        size: 208,
        meta: {
          headerLabel: tEntity('headers.updated'),
          align: 'right' as const,
          // The timestamp + copy control is nowrap; clip at the cell edge so a
          // long value cannot spill left into Status (preset `long` also
          // appends a timezone suffix that exceeded the old 128px column).
          className: 'overflow-hidden',
        },
        cell: ({ row }) => (
          <div className="w-0 min-w-full overflow-hidden">
            <CopyableTimestamp
              date={row.original.createdAt}
              // `medium` skips the timezone suffix in the cell; `title` still
              // carries the full localized value + zone for hover/copy.
              preset="medium"
              customFormat="ll LT"
              alignRight
            />
          </div>
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
