'use client';

import { ActionRow } from '@tale/ui/action-row';
import {
  ACTIONS_COLUMN_SIZE,
  createSelectColumn,
} from '@tale/ui/data-table/column-builders';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { Text } from '@tale/ui/text';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import { ApiKeyExpiresCell } from '../components/api-key-expires-cell';
import { ApiKeyOwnerCell } from '../components/api-key-owner-cell';
import { ApiKeyRowActions } from '../components/api-key-row-actions';
import type { ApiKey } from '../types';

interface ApiKeysTableConfig {
  columns: ColumnDef<ApiKey>[];
  stickyLayout: boolean;
  pageSize: number;
  infiniteScroll: boolean;
}

/** The masked key as its holder saw it: `start … suffix`. */
function maskedKey(apiKey: ApiKey): string {
  const head = apiKey.start || apiKey.prefix;
  const tail = apiKey.suffix;
  return head ? (tail ? `${head} … ${tail}` : head) : tail ? `… ${tail}` : '-';
}

export function useApiKeysTableConfig(
  organizationId: string,
  /** The signed-in member, so a key made for them reads as theirs. */
  viewerUserId?: string,
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
        // The masked key sits under its name: one column, so the owner and
        // the dates fit the settings page's measure beside it.
        cell: ({ row }) => (
          <div className="flex min-w-0 flex-col">
            <Text as="span" variant="label" truncate>
              {row.original.name || '-'}
            </Text>
            <Text
              as="span"
              variant="muted"
              truncate
              className="font-mono text-xs"
            >
              <span className="sr-only">
                {tSettings('apiKeys.columns.key')}:{' '}
              </span>
              {maskedKey(row.original)}
            </Text>
          </div>
        ),
      },
      {
        id: 'owner',
        header: tSettings('apiKeys.columns.owner'),
        size: 160,
        // Progressive disclosure on narrow screens: the name + key and the
        // actions always show; the owner and the expiry, then the other
        // dates, reveal as the viewport widens.
        meta: { className: 'hidden sm:table-cell' },
        cell: ({ row }) => (
          <ApiKeyOwnerCell apiKey={row.original} viewerUserId={viewerUserId} />
        ),
      },
      {
        id: 'expires',
        header: tSettings('apiKeys.columns.expires'),
        size: 120,
        meta: { className: 'hidden sm:table-cell' },
        cell: ({ row }) => (
          <ApiKeyExpiresCell expiresAt={row.original.expiresAt} />
        ),
      },
      {
        id: 'created',
        header: tSettings('apiKeys.columns.created'),
        size: 120,
        meta: { className: 'hidden lg:table-cell' },
        cell: ({ row }) => (
          <TableDateCell date={row.original.createdAt} preset="short" />
        ),
      },
      {
        id: 'lastUsed',
        header: tSettings('apiKeys.columns.lastUsed'),
        size: 120,
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
    [tSettings, organizationId, viewerUserId],
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
    pageSize: DEFAULT_LIST_PAGE_SIZE,
    infiniteScroll: false,
  };
}
