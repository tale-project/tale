'use client';

import { useState } from 'react';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { useApiSettingsAccess } from '@/app/features/settings/model-endpoints/hooks/use-api-settings-access';
import { useCurrentMemberContext } from '@/app/hooks/use-current-member-context';
import { useT } from '@/lib/i18n/client';

import { useAgentConnections } from '../hooks/queries';
import type { AgentConnectionsView } from '../types';
import { AgentConnectionFilters } from './agent-connection-filters';
import { AgentConnectionsTable } from './agent-connections-table';

interface AgentConnectionsSectionProps {
  organizationId: string;
}

/**
 * The coding agents people connected to this organization, as the signed-in
 * person may see them: their own, and for an owner or admin everyone's, with
 * the ended ones on request. Disconnecting one is the row's action.
 */
export function AgentConnectionsSection({
  organizationId,
}: AgentConnectionsSectionProps) {
  const { t } = useT('agentConnections');
  const { t: tNav } = useT('navigation');
  // Where a new agent is connected is the MCP tab, which opens for the roles
  // that hold the developer settings, and only while agents may sign in; a
  // member this page is open to for the agents they hold is offered nothing
  // to open.
  const { developer, connectAgents } = useApiSettingsAccess(organizationId);
  const { data: memberContext } = useCurrentMemberContext(organizationId);
  const viewer = memberContext?.status === 'ok' ? memberContext : undefined;
  const canSeeEveryone = viewer?.isAdmin === true;

  const [chosen, setChosen] = useState<AgentConnectionsView>({
    scope: 'mine',
    ended: false,
  });
  // Only an owner or admin chooses; anyone else sees their own, live ones.
  const view: AgentConnectionsView = canSeeEveryone
    ? chosen
    : { scope: 'mine', ended: false };

  const { data, error, refetch } = useAgentConnections(organizationId, view);

  return (
    <SettingsSection
      title={tNav('connectedAgents')}
      description={
        view.scope === 'everyone'
          ? t('list.adminDescription')
          : t('list.description')
      }
    >
      <AgentConnectionsTable
        connections={data?.connections}
        organizationId={organizationId}
        viewerUserId={viewer?.userId}
        everyone={view.scope === 'everyone'}
        connectHref={
          developer && connectAgents
            ? `/dashboard/${organizationId}/settings/api/mcp`
            : undefined
        }
        {...(canSeeEveryone
          ? {
              filters: (
                <AgentConnectionFilters view={view} onViewChange={setChosen} />
              ),
            }
          : {})}
        error={error}
        onRetry={() => void refetch()}
      />
    </SettingsSection>
  );
}
