/**
 * V8 accessor for the legacy `ssoProviders` table. The table still exists in
 * the schema as the migration source (it shipped in v0.2.85), but the unified
 * Enterprise SSO feature now reads sign-in config from per-org JSON files. This
 * helper centralises the untyped row access so the node migration's handler
 * (`'use node'`, never able to value-import generated server code without
 * dragging it into the node bundle) reads the legacy row via `ctx.runQuery`.
 *
 * Used by:
 *  - 01_enterprise_sso_unify (node) — reads the org's row to export to files.
 */

import { v } from 'convex/values';

import { internalQuery } from '../../../../_generated/server';

/** The legacy `ssoProviders` row shape (only the fields the migration consumes). */
export interface LegacySsoProviderRow {
  _id: string;
  organizationId: string;
  providerId: string;
  issuer: string;
  clientIdEncrypted: string;
  clientSecretEncrypted: string;
  scopes: string[];
  autoProvisionRole: boolean;
  roleMappingRules: {
    source: string;
    pattern: string;
    targetRole: string;
    claim?: string;
  }[];
  defaultRole: string;
  providerFeatures?: {
    entraId?: {
      enableOneDriveAccess?: boolean;
      autoProvisionTeam?: boolean;
      excludeGroups?: string[];
      seamlessSsoEnabled?: boolean;
      domainHint?: string;
    };
    googleWorkspace?: { enableGoogleDriveAccess?: boolean };
    genericOidc?: {
      emailClaim?: string;
      nameClaim?: string;
      groupsClaim?: string;
      autoProvisionTeam?: boolean;
      excludeGroups?: string[];
    };
  };
  createdAt?: number;
  updatedAt?: number;
}

/**
 * The org's single legacy `ssoProviders` row, or `null` when the org has none
 * (a fresh install that never configured SSO) — in which case the migration is
 * a per-org no-op. The query against a truly-absent table throws; we treat that
 * as "no row" rather than failing the whole migration.
 */
export const getSsoProviderByOrg = internalQuery({
  args: { organizationId: v.string() },
  returns: v.union(v.any(), v.null()),
  handler: async (ctx, args): Promise<LegacySsoProviderRow | null> => {
    try {
      const row = await ctx.db
        .query('ssoProviders')
        .withIndex('organizationId', (q) =>
          q.eq('organizationId', args.organizationId),
        )
        .first();
      return (row as LegacySsoProviderRow | null) ?? null;
    } catch (err) {
      console.warn(
        '[migration 0.2.87] ssoProviders table not readable (likely already dropped):',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  },
});
