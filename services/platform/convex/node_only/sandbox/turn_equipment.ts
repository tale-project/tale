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
 *  2. The Tier-2 connector BROKER — brokerable connector grants (github) whose
 *     secret enters the box as a CLI-consumable env var + git credential
 *     helper (`resolveSessionCredentialEnv`).
 *
 * Precedence on a name collision: a broker/git-config key wins over an agent
 * secret (the git helper env is load-bearing and must not be shadowed by a
 * same-named secret); and `buildExternalTurnExec` then lets the HARNESS's own
 * env win over all of this. Every fetch is audited (`sandboxCredentialAccess`)
 * inside the two resolvers.
 */

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import {
  BROKERABLE_GRANTS,
  resolveSessionCredentialEnv,
} from './session_credentials';

/**
 * Resolve a turn's secret + broker env. Best-effort throughout: a failure in
 * either source is logged and skipped, never thrown — a credential gap can
 * only downgrade a turn, not kill it. Returns `{}` when the agent is equipped
 * with neither, so callers can pass it to `extraEnv` unconditionally.
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

  // Only brokerable grants inject env; skip the resolver entirely otherwise so
  // a turn with no git grant does no credential work.
  const brokerable = args.connectors.filter((slug) =>
    BROKERABLE_GRANTS.includes(slug),
  );
  if (brokerable.length > 0) {
    try {
      const broker = await resolveSessionCredentialEnv(ctx, {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        grants: brokerable,
        kind: 'git',
      });
      // Broker/git-config keys win over a same-named secret.
      Object.assign(env, broker.env);
    } catch (err) {
      console.warn(
        '[turn-equipment] connector broker failed (continuing):',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  return env;
}
