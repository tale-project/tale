'use node';

/**
 * The per-exec ENV a work-lane turn's equipment resolves to — shared by both
 * hosts (`tasks/agent_run_host.ts`, `automations/agent_host.ts`) so the two
 * lanes provision credentials identically. Two sources, both per-exec (they
 * die with the exec, so ungranting revokes on the next turn):
 *
 *  1. Agent SECRETS — the org's named `agentSecrets`, injected under their own
 *     names (a GlitchTip token as `GLITCHTIP_TOKEN`, etc.). The BYO escape
 *     hatch below the connector catalog.
 *  2. The Tier-2 connector BROKER — brokerable connector grants (those whose
 *     connector declares a git capability: GitHub, Forgejo) whose secret
 *     enters the box for the git credential helper, and GitHub's also as the
 *     env its CLI reads (`resolveSessionCredentialEnv`). A project agent's
 *     pinned credential replaces the connector's default there.
 *
 * Precedence on a name collision: a broker/git-config key wins over an agent
 * secret (the git helper env is load-bearing and must not be shadowed by a
 * same-named secret); and `buildExternalTurnExec` then lets the HARNESS's own
 * env win over all of this. Every fetch is audited (`sandboxCredentialAccess`)
 * inside the two resolvers.
 */

import type { ProjectAgentGitIdentity } from '@tale/shared/schemas/projects';

import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  isBrokerableGrant,
  resolveSessionCredentialEnv,
  resolveSessionGitIdentityEnv,
} from './session_credentials';

/**
 * Resolve a turn's secret + broker env. Best-effort throughout: a failure in
 * either source is logged and skipped, never thrown — a credential gap can
 * only downgrade a turn, not kill it. The commit identity (the agent's own,
 * else Tale's) needs no connector grant and survives a broker failure, so no
 * turn goes without one [SBX-R42].
 */
export async function resolveTurnEquipmentEnv(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    /** The agent/node's granted connector slugs (only brokerable ones inject
     * env; the rest stay dispatch-only behind the MCP bridge). */
    connectors: readonly string[];
    /** The agent/node's referenced org-secret names. */
    secrets: readonly string[];
    /** A project agent's pinned credential per connector, by name. */
    connectorCredentials?: Readonly<Record<string, string>>;
    /** A project agent's own commit identity. */
    gitIdentity?: ProjectAgentGitIdentity | null;
  },
): Promise<Record<string, string>> {
  const env: Record<string, string> = {};

  if (args.secrets.length > 0) {
    try {
      const resolved = await ctx.runAction(
        internal.agent_secrets.actions.resolveAgentSecretsEnv,
        {
          organizationId: args.organizationId,
          sessionId: args.sessionId,
          names: [...args.secrets],
        },
      );
      Object.assign(env, resolved.env);
    } catch (err) {
      console.warn(
        '[turn-equipment] agent-secret resolution failed (continuing):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  // Only brokerable grants inject credentials. The same resolver supplies
  // the non-secret commit identity with an empty grant list, including a
  // turn equipped only with a repository-scoped SSH secret.
  const brokerable = args.connectors.filter(isBrokerableGrant);
  try {
    const broker = await resolveSessionCredentialEnv(ctx, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      grants: brokerable,
      kind: 'git',
      ...(args.connectorCredentials !== undefined
        ? { connectorCredentials: args.connectorCredentials }
        : {}),
      ...(args.gitIdentity !== undefined
        ? { gitIdentity: args.gitIdentity }
        : {}),
    });
    // Broker/git-config keys win over a same-named secret.
    Object.assign(env, broker.env);
  } catch (err) {
    console.warn(
      '[turn-equipment] connector broker failed (continuing):',
      err instanceof Error ? err.message : String(err),
    );
    Object.assign(env, resolveSessionGitIdentityEnv(args.gitIdentity));
  }

  return env;
}

/**
 * The per-exec env of a CONFINED turn (TASK-R79): none of the agent's
 * secrets and no credential, pinned or default, but still the commit identity
 * (the agent's own, else Tale's [SBX-R42]) — non-secret, so a confined run
 * commits under the same name as any other run of the agent instead of
 * failing with "Author identity unknown".
 */
export function resolveConfinedTurnEnv(
  gitIdentity?: ProjectAgentGitIdentity | null,
): Record<string, string> {
  return resolveSessionGitIdentityEnv(gitIdentity);
}
