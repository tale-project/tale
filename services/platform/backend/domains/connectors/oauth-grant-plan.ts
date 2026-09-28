import type { ConsentIntent } from '../../../lib/shared/connector-consent.ts';
import { uniqueCredentialName } from '../../../lib/shared/utils/credential-name.ts';

/**
 * Where a completed connector consent lands — the pure half of
 * `storeOauth2Grant`, decided from what the store transaction read under its
 * locks, so every branch is testable without a database.
 *
 * The consent carries its INTENT from the start door, on the state row:
 *
 * - **Add** stores a NEW credential under a name no sibling holds (the
 *   connector's display name, then `Gmail 2`, …). It never renews another
 *   credential — with one exception that is not a different account: a Slack
 *   workspace this organization already connected renews its own credential,
 *   because the team route (one workspace, one credential) says the consent
 *   is for exactly that row.
 * - **Reconnect** renews exactly the credential it named, keeping its id,
 *   name, default flag and references. Gone meanwhile: refused, nothing
 *   written — never redirected onto a sibling. For Slack, the consent must be
 *   for that credential's own workspace; another workspace is refused instead
 *   of leaving one workspace's token behind another's route.
 *
 * A renewal clears `needs-reauth`; a DISABLED credential stays disabled — the
 * pause is the operator's decision and only Enable lifts it.
 */

/** Room a workspace-named label leaves for the ` N` a collision appends. */
const NAME_COUNTER_ROOM = 6;

export interface GrantSibling {
  id: string;
  name: string;
  authMethod: string;
  status: string;
}

export interface GrantPlanInput {
  organizationId: string;
  intent: ConsentIntent;
  /** The connector's catalog display name — the first credential's label. */
  displayName: string;
  /** The longest label a credential may carry. */
  nameMax: number;
  /** Every credential of the (organization, connector) pair, any method. */
  siblings: readonly GrantSibling[];
  /** A Reconnect's target as the transaction locked it; null when it is
   * gone, foreign, of another connector or no OAuth grant. */
  target: GrantSibling | null;
  /** The workspace the vendor reported (Slack's `team`), when it has one. */
  team?: { id: string; name?: string };
  /** The team route of `team.id`, when one exists. */
  route: { organizationId: string; credentialId: string } | null;
  /** Workspaces already routed to the Reconnect target. */
  targetTeams: readonly string[];
}

export type GrantPlan =
  | {
      kind: 'renew';
      credentialId: string;
      /** False for a disabled credential: the grant is renewed, the pause kept. */
      reactivate: boolean;
      /** Route this workspace to the renewed credential in the same transaction. */
      claimTeamId?: string;
    }
  | { kind: 'create'; name: string; claimTeamId?: string }
  | {
      kind: 'refuse';
      reason: 'credential_missing' | 'account_mismatch' | 'workspace_claimed';
    };

export function planOauth2Grant(input: GrantPlanInput): GrantPlan {
  const { team, route } = input;
  // A workspace belongs to one organization, whatever the intent.
  if (route !== null && route.organizationId !== input.organizationId) {
    return { kind: 'refuse', reason: 'workspace_claimed' };
  }

  if (input.intent.kind === 'reconnect') {
    const { target } = input;
    if (target === null || target.id !== input.intent.credentialId) {
      return { kind: 'refuse', reason: 'credential_missing' };
    }
    const renew = {
      kind: 'renew' as const,
      credentialId: target.id,
      reactivate: target.status !== 'disabled',
    };
    if (team === undefined) return renew;
    if (route !== null) {
      return route.credentialId === target.id
        ? renew
        : { kind: 'refuse', reason: 'account_mismatch' };
    }
    // An unrouted workspace joins the target only when the target holds no
    // other one — never one workspace's token behind another's route.
    if (input.targetTeams.some((teamId) => teamId !== team.id)) {
      return { kind: 'refuse', reason: 'account_mismatch' };
    }
    return { ...renew, claimTeamId: team.id };
  }

  const grants = input.siblings.filter((row) => row.authMethod === 'oauth2');
  const routed =
    team === undefined || route === null
      ? undefined
      : grants.find((row) => row.id === route.credentialId);
  if (routed !== undefined) {
    return {
      kind: 'renew',
      credentialId: routed.id,
      reactivate: routed.status !== 'disabled',
    };
  }

  const workspace = team?.name?.trim() ?? '';
  const base =
    grants.length === 0 || workspace.length === 0
      ? input.displayName
      : `${input.displayName} (${workspace})`.slice(
          0,
          input.nameMax - NAME_COUNTER_ROOM,
        );
  return {
    kind: 'create',
    name: uniqueCredentialName(
      input.siblings.map((row) => row.name),
      base,
    ),
    ...(team !== undefined ? { claimTeamId: team.id } : {}),
  };
}
