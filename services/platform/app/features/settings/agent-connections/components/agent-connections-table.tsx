'use client';

import { DataTable } from '@tale/ui/data-table/data-table';
import { useListPage } from '@tale/ui/use-list-page';
import { Bot, Plus } from 'lucide-react';
import type { ReactNode, RefObject } from 'react';

import { useT } from '@/lib/i18n/client';

import { useAgentConnectionsTableConfig } from '../hooks/use-agent-connections-table-config';
import type { AgentConnection } from '../types';

interface AgentConnectionsTableProps {
  connections: AgentConnection[] | undefined;
  organizationId: string;
  /** The signed-in person, so their own agents read as theirs. */
  viewerUserId: string | undefined;
  /** Whether everyone's agents are listed, not only the person's own. */
  everyone: boolean;
  /** What "Connect a coding agent" does; none for a person who may not
   * connect one. */
  onConnect: (() => void) | undefined;
  /** The button that opens it, so focus can come back to it. */
  connectTriggerRef?: RefObject<HTMLButtonElement | null>;
  /** What an owner or admin chooses the list by, beside the table's own
   * controls. */
  filters?: ReactNode;
  error?: Error | null;
  onRetry?: () => void;
}

export function AgentConnectionsTable({
  connections,
  organizationId,
  viewerUserId,
  everyone,
  onConnect,
  connectTriggerRef,
  filters,
  error,
  onRetry,
}: AgentConnectionsTableProps) {
  const { t } = useT('agentConnections');
  const { columns, stickyLayout, pageSize } = useAgentConnectionsTableConfig({
    organizationId,
    viewerUserId,
    everyone,
  });

  const list = useListPage<AgentConnection>({
    dataSource: {
      type: 'query',
      data: connections,
      // A cold failure needs recovery; a failed refresh keeps the rows.
      error: connections === undefined ? error : null,
      retry: onRetry,
    },
    pageSize,
    // Another view of the connections starts the window over.
    windowKey: everyone ? 'everyone' : 'mine',
    getRowId: (row) => row.id,
    entityLabel: {
      one: t('list.entityLabelOne'),
      other: t('list.entityLabel'),
    },
  });

  return (
    <DataTable
      columns={columns}
      stickyLayout={stickyLayout}
      caption={t('list.caption')}
      // The standard create affordance: in the toolbar once there are rows,
      // in the empty state while there are none. Wait for the first answer so
      // a focused opener is never taken away by an empty read.
      addAction={
        connections === undefined || onConnect === undefined
          ? undefined
          : {
              label: t('list.connectAction'),
              icon: Plus,
              onClick: onConnect,
              ...(connectTriggerRef === undefined
                ? {}
                : { triggerRef: connectTriggerRef }),
            }
      }
      filtersContent={filters}
      emptyState={{
        icon: Bot,
        title: t('list.empty.title'),
        description: t('list.empty.description'),
      }}
      {...list.tableProps}
    />
  );
}
