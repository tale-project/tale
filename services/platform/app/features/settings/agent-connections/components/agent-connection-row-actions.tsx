'use client';

import { EntityRowActions } from '@tale/ui/entity/entity-row-actions';
import { Unplug } from 'lucide-react';
import { useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AgentConnection } from '../types';
import { DisconnectAgentDialog } from './disconnect-agent-dialog';

interface AgentConnectionRowActionsProps {
  connection: AgentConnection;
  organizationId: string;
  viewerUserId: string | undefined;
}

/** What a person does with a connected agent: disconnect it. An agent that
 * is already disconnected has nothing left to do. */
export function AgentConnectionRowActions({
  connection,
  organizationId,
  viewerUserId,
}: AgentConnectionRowActionsProps) {
  const { t } = useT('agentConnections');
  const [disconnecting, setDisconnecting] = useState(false);

  const actions = useMemo(
    () => [
      {
        key: 'disconnect',
        label: t('list.actions.disconnect'),
        icon: Unplug,
        onClick: () => setDisconnecting(true),
        destructive: true,
      },
    ],
    [t],
  );

  if (connection.revokedAt !== null) return null;

  return (
    <>
      <EntityRowActions
        actions={actions}
        ariaLabel={t('list.actionsLabel', { client: connection.clientName })}
      />
      <DisconnectAgentDialog
        open={disconnecting}
        onOpenChange={setDisconnecting}
        connection={connection}
        organizationId={organizationId}
        viewerUserId={viewerUserId}
      />
    </>
  );
}
