import { useCallback } from 'react';

import { useAgentConnectionAccess } from '@/app/features/settings/agent-connections/hooks/queries';
import {
  useMyApiKeyAccess,
  useMyModelApiAccess,
} from '@/app/features/settings/governance/hooks/queries';
import { useAbility, useAbilityLoading } from '@/app/hooks/use-ability';
import { readStateOf } from '@/app/lib/backend/read-state';

/**
 * Who may open which API settings tab. Owners, admins and developers — the
 * role's developer settings — see every tab. A member of any other role who
 * may create a personal API key (a live grant of a competence that is used
 * with one, the rule the key's create endpoint holds them to) sees REST,
 * where the key is made; so does one who holds a key after that right
 * lapsed, to see and revoke it. One who may call the model endpoints (a
 * live `tale:models.api` grant) sees Models too, where a tool is set up.
 * Connected agents is another door: it exists once the deployment lets coding
 * agents sign in, for whoever may connect one here (the developer roles
 * among them), and for one who holds a live connection whatever the
 * deployment says, to see and disconnect theirs.
 *
 * A read that never answered decides nothing. The tabs it would open are
 * `undecided` until it does: a failure to name and try again, never a
 * refusal (#4767). A tab the role or another read already opens does not
 * wait on it, so a developer's grant reads never leave one undecided.
 */
export interface ApiSettingsAccess {
  /** Owner, admin or developer by role: every API tab. */
  developer: boolean;
  /** Opens the REST tab: may create a personal API key, or holds one. */
  apiKeys: boolean;
  /** May create a personal API key — by role or through a grant. */
  createApiKeys: boolean;
  /** May call the model endpoints — by role or through the grant. */
  modelApi: boolean;
  /** Opens the Connected agents tab: agents may sign in and the person may
   * connect one here, or they hold a live connection. Not a matter of the
   * role alone, so a developer role does not open it by itself. */
  agents: boolean;
  /** May connect a coding agent here, and the deployment lets agents sign
   * in: what the tab offers a way to do. */
  connectAgents: boolean;
  /** The tabs a failed read leaves undecided: nothing else opens them, and
   * the read that would say never answered. Such a tab's flag above is
   * `false`, yet it is not closed either. */
  undecided: { apiKeys: boolean; modelApi: boolean; agents: boolean };
  /** What the first of those failed reads threw; `null` when none failed,
   * and while they are asked again. */
  error: Error | null;
  /** The failed reads are being asked again. */
  retrying: boolean;
  /** How many times the access reads settled in error: a notice keyed on
   * it is announced afresh for each new failure. */
  failureCount: number;
  /** Ask the failed reads again. */
  retry: () => void;
  /** The role or, for a member who needs them, the grants are still loading.
   * A failed read asked again does not count: it stays undecided meanwhile. */
  loading: boolean;
}

export function useApiSettingsAccess(
  organizationId: string,
): ApiSettingsAccess {
  const ability = useAbility();
  const abilityLoading = useAbilityLoading();
  const developer = ability.can('read', 'developerSettings');
  const standing = useMyModelApiAccess(organizationId);
  const keys = useMyApiKeyAccess(organizationId);
  const agentAccess = useAgentConnectionAccess(organizationId);
  const modelApi = developer || standing.data?.allowed === true;
  const connectAgents =
    agentAccess.data?.signInOn === true && agentAccess.data.mayConnect;
  // Calling the model endpoints takes a key, so their grant is one of the
  // competences that let a member make one.
  const createApiKeys = modelApi || keys.data?.mayCreate === true;
  const apiKeys = createApiKeys || keys.data?.holdsKeys === true;
  const agents = agentAccess.data?.holdsConnection === true || connectAgents;

  // A read that answered before keeps deciding by its last answer through a
  // failed refresh; one that never answered leaves undecided what it alone
  // would open.
  const standingRead = readStateOf(standing);
  const keysRead = readStateOf(keys);
  const agentsRead = readStateOf(agentAccess);
  const standingFailed = !developer && standingRead.unavailable;
  const keysFailed = !apiKeys && keysRead.unavailable;
  const agentsFailed = agentsRead.unavailable;

  const { refetch: refetchStanding } = standing;
  const { refetch: refetchKeys } = keys;
  const { refetch: refetchAgents } = agentAccess;
  const retry = useCallback(() => {
    if (standingFailed) void refetchStanding();
    if (keysFailed) void refetchKeys();
    if (agentsFailed) void refetchAgents();
  }, [
    standingFailed,
    keysFailed,
    agentsFailed,
    refetchStanding,
    refetchKeys,
    refetchAgents,
  ]);

  return {
    developer,
    apiKeys,
    createApiKeys,
    modelApi,
    agents,
    connectAgents,
    undecided: {
      apiKeys: keysFailed || (!apiKeys && standingFailed),
      modelApi: standingFailed,
      agents: agentsFailed,
    },
    error:
      (standingFailed ? standing.error : null) ??
      (keysFailed ? keys.error : null) ??
      (agentsFailed ? agentAccess.error : null),
    retrying:
      (standingFailed && standingRead.retrying) ||
      (keysFailed && keysRead.retrying) ||
      (agentsFailed && agentsRead.retrying),
    failureCount:
      standingRead.failureCount +
      keysRead.failureCount +
      agentsRead.failureCount,
    retry,
    loading:
      abilityLoading ||
      (agentAccess.isLoading && !agentsRead.unavailable) ||
      (!developer &&
        ((standing.isLoading && !standingRead.unavailable) ||
          (keys.isLoading && !keysRead.unavailable))),
  };
}
