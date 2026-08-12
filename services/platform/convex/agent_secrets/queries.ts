/**
 * Read side of org agent secrets. Metadata only — name, description, masked
 * preview, timestamps. Plaintext and ciphertext never leave `'use node'` code
 * (`resolve.ts`); nothing here can surface either.
 */

import { v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import type { Doc } from '../_generated/dataModel';
import { internalQuery, query, type QueryCtx } from '../_generated/server';
import { checkMembership } from '../documents/check_membership';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';

export interface AgentSecretSummary {
  name: string;
  description: string | null;
  maskedPreview: string | null;
  updatedAt: number;
  updatedBy: string;
}

function toSummary(row: Doc<'agentSecrets'>): AgentSecretSummary {
  return {
    name: row.name,
    description: row.description ?? null,
    maskedPreview: row.maskedPreview ?? null,
    updatedAt: row.updatedAt,
    updatedBy: row.updatedBy,
  };
}

async function collectOrgSecrets(
  ctx: QueryCtx,
  organizationId: string,
): Promise<Doc<'agentSecrets'>[]> {
  const rows = await ctx.db
    .query('agentSecrets')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .collect();
  rows.sort((a, b) => a.name.localeCompare(b.name));
  return rows;
}

/**
 * The org's agent-secret catalog for the equipment picker and the manager.
 * Gated on the developer-settings capability: a secret is a credential (its
 * masked preview is still a partial reveal, and equipping one lets an agent
 * read its plaintext), so only the roles that may WRITE the store may read the
 * catalog — the same audience `requireOrgAdminOrDeveloper` guards on the
 * mutations. Everyone else sees an empty catalog and cannot equip a secret.
 */
export const listAgentSecrets = query({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      name: v.string(),
      description: v.union(v.string(), v.null()),
      maskedPreview: v.union(v.string(), v.null()),
      updatedAt: v.number(),
      updatedBy: v.string(),
    }),
  ),
  handler: async (ctx, args): Promise<AgentSecretSummary[]> => {
    // Fail-closed: an unauthenticated caller, a non-member, or a member
    // without the developer capability sees an empty catalog, never an error.
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return [];
    const member = await checkMembership(ctx, {
      userId: authUser.userId,
      organizationId: args.organizationId,
    });
    if (member === null) return [];
    if (
      defineAbilityFor(member.role ?? null).cannot('read', 'developerSettings')
    ) {
      return [];
    }
    const rows = await collectOrgSecrets(ctx, args.organizationId);
    return rows.map(toSummary);
  },
});

/** The set of secret NAMES that exist in an org — for validating an agent's
 * `secrets[]` against real rows at config-write time. */
export const listAgentSecretNamesInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, args): Promise<string[]> => {
    const rows = await collectOrgSecrets(ctx, args.organizationId);
    return rows.map((row) => row.name);
  },
});

/** The rows an exec injection needs — name + ciphertext for the requested
 * names, org-scoped. Internal, `resolve.ts` decrypts. */
export const listAgentSecretsForInjection = internalQuery({
  args: { organizationId: v.string(), names: v.array(v.string()) },
  returns: v.array(
    v.object({
      name: v.string(),
      encryptedValue: v.object({
        ciphertext: v.string(),
        nonce: v.string(),
        authTag: v.string(),
        keyFingerprint: v.string(),
      }),
    }),
  ),
  handler: async (ctx, args) => {
    if (args.names.length === 0) return [];
    const wanted = new Set(args.names);
    const rows = await ctx.db
      .query('agentSecrets')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows
      .filter((row) => wanted.has(row.name))
      .map((row) => ({ name: row.name, encryptedValue: row.encryptedValue }));
  },
});
