'use client';

import { ActionRow } from '@tale/ui/action-row';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { TableDateCell } from '@/app/components/ui/data-display/table-date-cell';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@/app/components/ui/data-table/column-builders';
import { useT } from '@/lib/i18n/client';

import { ApiKeyRowActions } from '../components/api-key-row-actions';
import type { ApiKey } from '../types';

interface ApiKeysTableConfig {
  columns: ColumnDef<ApiKey>[];
  stickyLayout: boolean;
  pageSize: number;
  infiniteScroll: boolean;
}

export function useApiKeysTableConfig(
  organizationId: string,
): ApiKeysTableConfig {
  const { t: tSettings } = useT('settings');

  const columns = useMemo<ColumnDef<ApiKey>[]>(
    () => [
      // Multi-row select — canonical 40px column matching every other entity
      // table. Enables bulk-revoke via the `BulkDeleteBar` footer.
      createSelectColumn<ApiKey>(),
      {
        accessorKey: 'name',
        header: tSettings('apiKeys.columns.name'),
        cell: ({ row }) => (
          <Text as="span" variant="label">
            {row.original.name || '-'}
          </Text>
        ),
      },
      {
        id: 'key',
        header: tSettings('apiKeys.columns.key'),
        // Progressive disclosure on narrow screens: name + actions always show;
        // the key and dates reveal as the viewport widens.
        meta: { className: 'hidden sm:table-cell' },
        cell: ({ row }) => {
          const head = row.original.start || row.original.prefix;
          const tail = row.original.suffix;
          const display = head
            ? tail
              ? `${head} … ${tail}`
              : head
            : tail
              ? `… ${tail}`
              : '-';
          return (
            <Text as="span" variant="muted" className="font-mono text-sm">
              {display}
            </Text>
          );
        },
      },
      {
        id: 'created',
        header: tSettings('apiKeys.columns.created'),
        size: 140,
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <TableDateCell date={row.original.createdAt} preset="short" />
        ),
      },
      {
        id: 'lastUsed',
        header: tSettings('apiKeys.columns.lastUsed'),
        size: 140,
        meta: { className: 'hidden md:table-cell' },
        cell: ({ row }) => (
          <TableDateCell
            date={row.original.lastRequest}
            preset="short"
            emptyText={tSettings('apiKeys.neverUsed')}
          />
        ),
      },
      {
        id: 'actions',
        // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
        // every other table's actions column.
        size: ACTIONS_COLUMN_SIZE,
        meta: { isAction: true },
        cell: ({ row }) => (
          <ActionRow justify="end">
            <ApiKeyRowActions
              apiKey={row.original}
              organizationId={organizationId}
            />
          </ActionRow>
        ),
      },
    ],
    [tSettings, organizationId],
  );

  return {
    columns,
    // Non-sticky (like skills/providers): this table renders under
    // `SettingsPage` without `fitToContainer`, so there's no bounded-height
    // ancestor to drive a sticky inner scroll container. With `stickyLayout`,
    // that inner `overflow-auto`/`overscroll-contain` collapsed to content
    // height and swallowed the wheel over the table — the page couldn't be
    // scrolled from there (#2381, same trap fixed for skills in #2436). Let the
    // settings page own the single vertical scroll instead.
    stickyLayout: false,
    pageSize: 20,
    infiniteScroll: false,
  };
}
