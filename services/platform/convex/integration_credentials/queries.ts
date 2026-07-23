/**
 * Read surface of the integration-credential domain.
 *
 * The public reads are MASKED by construction: they project metadata plus
 * the write-time `maskedPreview` and never select `encryptedData`, so secret
 * material cannot cross to a client whatever the caller's role. Reads are
 * gated on plain org membership (the settings page fronting them is
 * developer-gated; the data here is non-secret metadata) and always scoped
 * to the caller's organization.
 *
 * The internal queries return full rows — ciphertext included — for the
 * `'use node'` action layer (`actions.ts`, `resolve_credential.ts`).
 * Internal functions are unreachable from clients.
 */

import { ConvexError, v } from 'convex/values';

import type { Doc } from '../_generated/dataModel';
import { internalQuery, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls/auth/get_auth_user_identity';
import { getOrganizationMember } from '../lib/rls/organization/get_organization_member';
import {
  integrationAuthMethodValidator,
  integrationCredentialStatusValidator,
} from './schema';

const maskedCredentialValidator = v.object({
  id: v.id('integrationCredentials'),
  connectorSlug: v.string(),
  authMethod: integrationAuthMethodValidator,
  name: v.string(),
  /** Per-credential API origin (`endpointMode: per-credential` connectors) —
   * which instance this credential points at, not a secret. */
  endpointUrl: v.optional(v.string()),
  maskedPreview: v.optional(v.string()),
  isDefault: v.boolean(),
  status: integrationCredentialStatusValidator,
  statusDetail: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

function toMasked(row: Doc<'integrationCredentials'>) {
  return {
    id: row._id,
    connectorSlug: row.connectorSlug,
    authMethod: row.authMethod,
    name: row.name,
    ...(row.endpointUrl !== undefined && { endpointUrl: row.endpointUrl }),
    ...(row.maskedPreview !== undefined && {
      maskedPreview: row.maskedPreview,
    }),
    isDefault: row.isDefault,
    status: row.status,
    ...(row.statusDetail !== undefined && { statusDetail: row.statusDetail }),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * The organization's credentials, masked, ordered by connector then name for
 * a stable settings listing. `connectorSlug` narrows the list to one
 * connector — what the connector's own settings panel and the workflow
 * credential picker read.
 */
export const listCredentials = query({
  args: {
    organizationId: v.string(),
    connectorSlug: v.optional(v.string()),
  },
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
    const connectorSlug = args.connectorSlug;
    const rows =
      connectorSlug === undefined
        ? await ctx.db
            .query('integrationCredentials')
            .withIndex('by_org', (q) =>
              q.eq('organizationId', args.organizationId),
            )
            .collect()
        : await ctx.db
            .query('integrationCredentials')
            .withIndex('by_org_connector', (q) =>
              q
                .eq('organizationId', args.organizationId)
                .eq('connectorSlug', connectorSlug),
            )
            .collect();
    return rows
      .sort(
        (a, b) =>
          a.connectorSlug.localeCompare(b.connectorSlug) ||
          a.name.localeCompare(b.name),
      )
      .map(toMasked);
  },
});

/** One credential by id, masked. A row of another organization reads as
 * not-found — existence is never leaked across tenants. */
export const getCredential = query({
  args: {
    organizationId: v.string(),
    credentialId: v.id('integrationCredentials'),
  },
  returns: maskedCredentialValidator,
  handler: async (ctx, args) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) {
      throw new ConvexError({
        code: 'UNAUTHENTICATED',
        message: 'Authentication required.',
      });
    }
    await getOrganizationMember(ctx, args.organizationId, authUser);
    const row = await ctx.db.get(args.credentialId);
    if (!row || row.organizationId !== args.organizationId) {
      throw new ConvexError({
        code: 'CREDENTIAL_NOT_FOUND',
        message: 'Credential not found.',
      });
    }
    return toMasked(row);
  },
});

/** One full row by id — ciphertext included; `'use node'` callers only. */
export const getCredentialInternal = internalQuery({
  args: { credentialId: v.id('integrationCredentials') },
  // Full row incl. system fields; v.any() also admits the null miss.
  returns: v.any(),
  handler: async (ctx, args) => {
    return await ctx.db.get(args.credentialId);
  },
});

/**
 * The row an invocation addresses, resolved inside ONE transaction so the
 * lookup rules stay together and tenant-scoped:
 *
 *  - no `credentialRef` → the (org, connector) default;
 *  - a ref that normalizes to an id of this org's connector → that row;
 *  - otherwise the ref is treated as a NAME, matched case-insensitively
 *    within the pair (what a workflow node's `credential: "Support inbox"`
 *    carries).
 *
 * Returns null when nothing matches — the caller turns that into the
 * actionable refusal, since only it knows whether a default was expected.
 * Full row (ciphertext included); `'use node'` callers only.
 */
export const resolveCredentialRefInternal = internalQuery({
  args: {
    organizationId: v.string(),
    connectorSlug: v.string(),
    credentialRef: v.optional(v.string()),
  },
  // Full row incl. system fields; v.any() also admits the null miss.
  returns: v.any(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('integrationCredentials')
      .withIndex('by_org_connector', (q) =>
        q
          .eq('organizationId', args.organizationId)
          .eq('connectorSlug', args.connectorSlug),
      )
      .collect();
    if (args.credentialRef === undefined) {
      return rows.find((row) => row.isDefault) ?? null;
    }
    const ref = args.credentialRef.trim();
    const asId = ctx.db.normalizeId('integrationCredentials', ref);
    if (asId !== null) {
      const byId = rows.find((row) => row._id === asId);
      if (byId) return byId;
    }
    const needle = ref.toLowerCase();
    return rows.find((row) => row.name.toLowerCase() === needle) ?? null;
  },
});
