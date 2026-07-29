/**
 * Read surface of the provider-credential domain.
 *
 * The public list is MASKED by construction: it projects metadata plus the
 * write-time `maskedPreview` and never selects `encryptedData`, so secret
 * material cannot cross to a client whatever the caller's role. Reads are
 * gated on plain org membership (the settings page fronting them is
 * developer-gated; the data here is non-secret metadata).
 *
 * The internal queries return full rows — ciphertext included — for the
 * `'use node'` action layer (`actions.ts`, `resolve_credential.ts`) and the
 * file→row migration. Internal functions are unreachable from clients.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  providerAuthMethodValidator,
  providerCredentialStatusValidator,
} from './schema';

const maskedCredentialValidator = v.object({
  id: v.id('providerCredentials'),
  providerSlug: v.string(),
  authMethod: providerAuthMethodValidator,
  name: v.string(),
  envName: v.optional(v.string()),
  /** Per-credential wire endpoint (Azure-style providers) — an endpoint
   * hostname, not a secret. */
  endpointUrl: v.optional(v.string()),
  maskedPreview: v.optional(v.string()),
  modelAllowlist: v.optional(v.array(v.string())),
  isDefault: v.boolean(),
  status: providerCredentialStatusValidator,
  createdAt: v.number(),
  updatedAt: v.number(),
});

function toMasked(row: Doc<'providerCredentials'>) {
  return {
    id: row._id,
    providerSlug: row.providerSlug,
    authMethod: row.authMethod,
    name: row.name,
    ...(row.envName !== undefined && { envName: row.envName }),
    ...(row.endpointUrl !== undefined && { endpointUrl: row.endpointUrl }),
    ...(row.maskedPreview !== undefined && {
      maskedPreview: row.maskedPreview,
    }),
    ...(row.modelAllowlist !== undefined && {
      modelAllowlist: row.modelAllowlist,
    }),
    isDefault: row.isDefault,
    status: row.status,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** Every credential of the caller's organization, masked, ordered by
 * provider then name for a stable settings listing. */
export const listCredentials = query({
  args: { organizationId: v.string() },
  returns: v.array(maskedCredentialValidator),
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
    }
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows
      .sort(
        (a, b) =>
          a.providerSlug.localeCompare(b.providerSlug) ||
          a.name.localeCompare(b.name),
      )
      .map(toMasked);
  },
});

/** One full row by id — ciphertext included; `'use node'` callers only. */
export const getCredentialInternal = internalQuery({
  args: { credentialId: v.id('providerCredentials') },
  // Full row incl. system fields; v.any() also admits the null miss.
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.credentialId);
  },
});

/** The default credential of an (org, provider) pair, or null. */
export const getDefaultCredentialInternal = internalQuery({
  args: { organizationId: v.string(), providerSlug: v.string() },
  // Full row incl. system fields; v.any() also admits the null miss.
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_org_provider', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('providerSlug', args.providerSlug),
      )
      .collect();
    return rows.find((row) => row.isDefault) ?? null;
  },
});

/** Minimal per-row facts for the file→row migration's idempotency check. */
export const listCredentialFactsInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      providerSlug: v.string(),
      name: v.string(),
      createdBy: v.string(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('providerCredentials')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows.map((row) => ({
      providerSlug: row.providerSlug,
      name: row.name,
      createdBy: row.createdBy,
    }));
  },
});
