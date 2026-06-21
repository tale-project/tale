// Per-agent env/secrets — V8 table + mutations/queries.
//
// Scope: one row per (organizationId, agentSlug, key). Plain vars carry a
// plaintext `value`; secrets carry an `encryptedValue` (JWE) and are write-only
// — the read API never returns a secret's plaintext. Resolved at the agent's
// external-run CLAIM (decrypt-at-run, real-time) and injected into the runtime
// process. Mirrors `sandbox/user_env` but agent-scoped (org-shared, not
// per-user). Encryption lives in the Node action `agent_env_actions.ts`.

import { ConvexError, v } from 'convex/values';

import type { MutationCtx, QueryCtx } from '../_generated/server';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from '../_generated/server';
import { requireAuthenticatedUser } from '../lib/rls/auth/require_authenticated_user';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import { SECRET_MASK } from '../sandbox/user_env_constants';

/** Per-agent guardrail on the number of env/secret entries. */
export const MAX_ENV_VARS_PER_AGENT = 100;

/** Assert the caller is a live member of the org (the edit gate — configuring
 *  an agent is already a privileged, org-shared action). */
async function requireOrgMember(
  ctx: QueryCtx | MutationCtx,
  organizationId: string,
): Promise<void> {
  const authUser = await requireAuthenticatedUser(ctx);
  await getOrganizationMember(ctx, organizationId, { userId: authUser.userId });
}

/**
 * Upsert one agent env/secret row. Internal — the public entry is the Node
 * action `setAgentEnvVar`, which authenticates, validates, and (for secrets)
 * encrypts before calling this. Enforces the per-agent count cap on inserts.
 */
export const upsertAgentEnvInternal = internalMutation({
  args: {
    organizationId: v.string(),
    agentSlug: v.string(),
    key: v.string(),
    isSecret: v.boolean(),
    value: v.optional(v.string()),
    encryptedValue: v.optional(v.string()),
    maskedPreview: v.optional(v.string()),
    updatedBy: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('agentEnv')
      .withIndex('by_org_agent_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug)
          .eq('key', args.key),
      )
      .first();

    const now = Date.now();
    const fields = {
      isSecret: args.isSecret,
      // Exactly one of value / encryptedValue is set; clear the other so a
      // secret↔non-secret flip never leaves a stale field. The masked preview
      // exists only for secrets.
      value: args.isSecret ? undefined : args.value,
      encryptedValue: args.isSecret ? args.encryptedValue : undefined,
      maskedPreview: args.isSecret ? args.maskedPreview : undefined,
      updatedAt: now,
      updatedBy: args.updatedBy,
    };

    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return null;
    }

    const count = (
      await ctx.db
        .query('agentEnv')
        .withIndex('by_org_agent', (q) =>
          q
            .eq('organizationId', args.organizationId)
            .eq('agentSlug', args.agentSlug),
        )
        .collect()
    ).length;
    if (count >= MAX_ENV_VARS_PER_AGENT) {
      throw new ConvexError({
        code: 'too_many',
        message: `An agent can have at most ${MAX_ENV_VARS_PER_AGENT} environment variables.`,
      });
    }

    await ctx.db.insert('agentEnv', {
      organizationId: args.organizationId,
      agentSlug: args.agentSlug,
      key: args.key,
      ...fields,
    });
    return null;
  },
});

/**
 * Raw rows for injection (the Node `resolveAgentEnv` action decrypts secrets).
 * Internal-only — returns ciphertext, never exposed to the browser.
 */
export const listAgentEnvForInjection = internalQuery({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.array(
    v.object({
      key: v.string(),
      isSecret: v.boolean(),
      value: v.optional(v.string()),
      encryptedValue: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('agentEnv')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .collect();
    return rows.map((r) => {
      const entry: {
        key: string;
        isSecret: boolean;
        value?: string;
        encryptedValue?: string;
      } = { key: r.key, isSecret: r.isSecret };
      if (r.value !== undefined) entry.value = r.value;
      if (r.encryptedValue !== undefined)
        entry.encryptedValue = r.encryptedValue;
      return entry;
    });
  },
});

/**
 * List an agent's env/secrets for the inline editor. Secrets are write-only:
 * plaintext is never returned — `value` is present only for non-secret vars;
 * secrets carry a fixed mask.
 */
export const listAgentEnv = query({
  args: { organizationId: v.string(), agentSlug: v.string() },
  returns: v.array(
    v.object({
      key: v.string(),
      isSecret: v.boolean(),
      value: v.optional(v.string()),
      maskedValue: v.optional(v.string()),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId);
    const rows = await ctx.db
      .query('agentEnv')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug),
      )
      .collect();
    return rows
      .sort((a, b) => a.key.localeCompare(b.key))
      .map((r) => {
        const entry: {
          key: string;
          isSecret: boolean;
          value?: string;
          maskedValue?: string;
          updatedAt: number;
        } = { key: r.key, isSecret: r.isSecret, updatedAt: r.updatedAt };
        // Secrets show a low-leak edge preview (older rows without one fall
        // back to the full mask); plaintext vars show their value.
        if (r.isSecret) entry.maskedValue = r.maskedPreview ?? SECRET_MASK;
        else entry.value = r.value ?? '';
        return entry;
      });
  },
});

/** Delete one of an agent's env/secret entries. */
export const deleteAgentEnvVar = mutation({
  args: { organizationId: v.string(), agentSlug: v.string(), key: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    await requireOrgMember(ctx, args.organizationId);
    const existing = await ctx.db
      .query('agentEnv')
      .withIndex('by_org_agent_key', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('agentSlug', args.agentSlug)
          .eq('key', args.key),
      )
      .first();
    if (existing) await ctx.db.delete(existing._id);
    return null;
  },
});

/**
 * Delete every env/secret entry for an installed app's agents. Internal —
 * called by app uninstall. Sweeps the WHOLE `<appSlug>/` agent namespace, not
 * just the manifest's current agents: a prior app version may have installed an
 * agent since renamed or removed, whose env/secrets (keyed by the old composite
 * `<app>/<name>` slug) would otherwise be orphaned and silently reattach on a
 * later reinstall. The `/` delimiter scopes the sweep to exactly this app — a
 * sibling app (`<appSlug>-2/…`) or a global agent (`<name>`) sorts outside the
 * range. An app's agents × env entries are bounded, so a single collect +
 * delete stays well under the mutation write budget.
 */
export const deleteAppAgentEnvInternal = internalMutation({
  args: { organizationId: v.string(), appSlug: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Exclusive upper bound = the code point right after '/' (0x2F -> 0x30):
    // ['<app>/', '<app>' + next) is exactly this app's agent namespace, so a
    // sibling app ('<app>-2/...') or a global agent ('<name>') sorts outside it.
    const prefix = `${args.appSlug}/`;
    const prefixEnd = `${args.appSlug}${String.fromCharCode(
      '/'.charCodeAt(0) + 1,
    )}`;
    const rows = await ctx.db
      .query('agentEnv')
      .withIndex('by_org_agent', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .gte('agentSlug', prefix)
          .lt('agentSlug', prefixEnd),
      )
      .collect();
    for (const row of rows) await ctx.db.delete(row._id);
    return null;
  },
});
