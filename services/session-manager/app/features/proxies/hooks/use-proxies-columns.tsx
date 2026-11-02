import {
  ACTIONS_COLUMN_SIZE,
  createActionsColumn,
} from '@tale/ui/data-table/column-builders';
import {
  TableIconCell,
  tableIconCellSkeleton,
} from '@tale/ui/data-table/table-icon-cell';
import type { ColumnDef } from '@tanstack/react-table';
import { Network } from 'lucide-react';
import { useMemo } from 'react';

import type { Proxy } from '@/lib/api/schemas';
import { useT } from '@/lib/i18n/client';

import { ProxyAddress } from '../components/proxy-address';
import { ProxyExit, ProxyPing } from '../components/proxy-exit';
import { ProxyHealth } from '../components/proxy-health';
import { ProxyRowActions } from '../components/proxy-row-actions';
import { ProxyRowSummary } from '../components/proxy-row-summary';
import { ProxySession } from '../components/proxy-session';

/**
 * What each column needs at the least, with the 24px its cells pad it with:
 * enough for an address of an IP and a port, an exit IP over its country in
 * the longer of the languages ("GB · Vereinigtes Königreich"), a ping of
 * thousands, the badge of the health over "Checked 13 minutes ago", and the
 * name of a session. A host name, an IPv6 address, a country, a session's name
 * and the reason a check failed are free text: they wrap (the reason behind a
 * Read more), so a row grows where it must and nothing is left to a tooltip.
 *
 * No column takes the slack of a wide window by itself: the table shares it by
 * these sizes, so a proxy's address, where it exits, its health and its session
 * grow together, and none is left to scroll away. How wide a window must be for
 * that is the sum of the sizes, `PROXIES_TABLE_MIN_WIDTH` (918 of a laptop
 * window's 940); a column narrower than that has one row per proxy.
 */
const SIZE = {
  proxy: 236,
  exit: 186,
  ping: 84,
  health: 190,
  session: 166,
  // The one column of the compact table: only its floor, since it takes all
  // that the menu leaves. Low enough that, with the menu, it fits the narrowest
  // phone (a window of 320px has 286px of table) and has nowhere to scroll to.
  compact: 200,
} as const;

export const PROXIES_TABLE_MIN_WIDTH =
  SIZE.proxy +
  SIZE.exit +
  SIZE.ping +
  SIZE.health +
  SIZE.session +
  ACTIONS_COLUMN_SIZE;

interface ProxiesColumnsOptions {
  /** The column is too narrow for the columns: one row per proxy, with everything in it. */
  compact: boolean;
}

/** The columns of the pool: wide, one for each thing a proxy says; compact, one that says it all. */
export function useProxiesColumns({
  compact,
}: ProxiesColumnsOptions): ColumnDef<Proxy>[] {
  const { t } = useT('proxies');

  return useMemo<ColumnDef<Proxy>[]>(() => {
    // The menu of the row, at the canonical size and with the table's own
    // "Row actions" for a screen reader, declared as the platform's
    // `use-websites-table-config.tsx` declares its own.
    const actions = createActionsColumn(ProxyRowActions, 'proxy');

    if (compact) {
      return [
        {
          id: 'proxy',
          header: t('columns.proxy'),
          size: SIZE.compact,
          meta: { skeleton: tableIconCellSkeleton({ lines: 2 }) },
          cell: ({ row }) => <ProxyRowSummary proxy={row.original} />,
        },
        actions,
      ];
    }

    return [
      {
        id: 'proxy',
        header: t('columns.proxy'),
        size: SIZE.proxy,
        meta: { skeleton: tableIconCellSkeleton() },
        cell: ({ row }) => (
          <TableIconCell
            icon={<Network />}
            label={<ProxyAddress proxy={row.original} />}
          />
        ),
      },
      {
        id: 'exit',
        header: t('columns.exit'),
        size: SIZE.exit,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => <ProxyExit check={row.original.check} />,
      },
      {
        id: 'ping',
        header: t('columns.ping'),
        size: SIZE.ping,
        meta: { align: 'right', skeleton: { type: 'text' } },
        cell: ({ row }) => <ProxyPing check={row.original.check} />,
      },
      {
        id: 'health',
        header: t('columns.health'),
        size: SIZE.health,
        meta: { skeleton: { type: 'badge', badge: { variant: 'slate' } } },
        cell: ({ row }) => <ProxyHealth check={row.original.check} />,
      },
      {
        id: 'session',
        header: t('columns.session'),
        size: SIZE.session,
        meta: { skeleton: { type: 'two-line' } },
        cell: ({ row }) => <ProxySession proxy={row.original} />,
      },
      actions,
    ];
  }, [t, compact]);
}
