'use client';

import { ActionRow } from '@tale/ui/action-row';
import { ACTIONS_COLUMN_SIZE } from '@tale/ui/data-table/column-builders';
import { tableIconCellSkeleton } from '@tale/ui/data-table/table-icon-cell';
import { DEFAULT_LIST_PAGE_SIZE } from '@tale/ui/list-page-size';
import { TableDateCell } from '@tale/ui/table-date-cell';
import { useMediaQuery } from '@tale/ui/use-media-query';
import type { ColumnDef } from '@tanstack/react-table';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import {
  AgentAccessCell,
  AgentCell,
  AgentPersonCell,
} from '../components/agent-connection-cells';
import { AgentConnectionRowActions } from '../components/agent-connection-row-actions';
import type { AgentConnection } from '../types';

interface AgentConnectionsTableConfig {
  columns: ColumnDef<AgentConnection>[];
  stickyLayout: boolean;
  pageSize: number;
}

/**
 * The columns of the connected agents, as many as the screen holds.
 *
 * A table's declared column sizes add up to the least width it will take —
 * a column hidden with CSS still counts — and it scrolls sideways inside its
 * frame when the page is narrower. This one is the place to disconnect an
 * agent, so on a phone the row menu must not sit hundreds of pixels to the
 * right: the columns a screen has no room for are left out of the table, not
 * hidden. The agent and its menu always show; the person (where more than one
 * person's agents are listed) from a large phone, the access and when the
 * agent last called from a tablet, and the day it connected beside the
 * settings page's rail on a wide screen. At every width the declared sizes
 * add up to what the page holds.
 */
export function useAgentConnectionsTableConfig(args: {
  organizationId: string;
  /** The signed-in person, so their own agents read as theirs. */
  viewerUserId: string | undefined;
  /** Whether everyone's agents are listed, not only the person's own. */
  everyone: boolean;
}): AgentConnectionsTableConfig {
  const { organizationId, viewerUserId, everyone } = args;
  const { t } = useT('agentConnections');
  // Desktop-first, as `useIsMobile` is: a screen that cannot say is a wide one.
  const belowSm = useMediaQuery('(max-width: 639px)');
  const belowMd = useMediaQuery('(max-width: 767px)');
  const belowXl = useMediaQuery('(max-width: 1279px)');

  const columns = useMemo<ColumnDef<AgentConnection>[]>(() => {
    const agent: ColumnDef<AgentConnection> = {
      id: 'agent',
      header: t('list.columns.agent'),
      size: 180,
      meta: { skeleton: tableIconCellSkeleton({ lines: 2 }) },
      cell: ({ row }) => <AgentCell connection={row.original} />,
    };
    const person: ColumnDef<AgentConnection> = {
      id: 'person',
      header: t('list.columns.person'),
      size: 130,
      meta: { skeleton: { type: 'two-line' } },
      cell: ({ row }) => (
        <AgentPersonCell
          connection={row.original}
          viewerUserId={viewerUserId}
        />
      ),
    };
    const access: ColumnDef<AgentConnection> = {
      id: 'access',
      header: t('list.columns.access'),
      size: 170,
      meta: { skeleton: { type: 'badge' } },
      cell: ({ row }) => <AgentAccessCell scopes={row.original.scopes} />,
    };
    const connected: ColumnDef<AgentConnection> = {
      id: 'connected',
      header: t('list.columns.connected'),
      size: 100,
      cell: ({ row }) => (
        <TableDateCell date={row.original.createdAt} preset="short" />
      ),
    };
    const lastUsed: ColumnDef<AgentConnection> = {
      id: 'lastUsed',
      header: t('list.columns.lastUsed'),
      size: 120,
      cell: ({ row }) => (
        <TableDateCell
          date={row.original.lastUsedAt}
          preset="relative"
          emptyText={t('list.never')}
        />
      ),
    };
    const actions: ColumnDef<AgentConnection> = {
      id: 'actions',
      // Named for assistive technology, which reads a column header with
      // nothing in it as a fault.
      header: () => (
        <span className="sr-only">{t('list.columns.actions')}</span>
      ),
      // Locked to `ACTIONS_COLUMN_SIZE` so the 3-dot column aligns with
      // every other table's actions column.
      size: ACTIONS_COLUMN_SIZE,
      meta: { isAction: true },
      cell: ({ row }) => (
        <ActionRow justify="end">
          <AgentConnectionRowActions
            connection={row.original}
            organizationId={organizationId}
            viewerUserId={viewerUserId}
          />
        </ActionRow>
      ),
    };
    return [
      agent,
      ...(everyone && !belowSm ? [person] : []),
      ...(belowMd ? [] : [access]),
      ...(belowXl ? [] : [connected]),
      ...(belowMd ? [] : [lastUsed]),
      actions,
    ];
  }, [t, organizationId, viewerUserId, everyone, belowSm, belowMd, belowXl]);

  return {
    columns,
    // Non-sticky, like the API keys table beside it: this table renders under
    // `SettingsPage` without `fitToContainer`, so the page owns the single
    // vertical scroll.
    stickyLayout: false,
    pageSize: DEFAULT_LIST_PAGE_SIZE,
  };
}
