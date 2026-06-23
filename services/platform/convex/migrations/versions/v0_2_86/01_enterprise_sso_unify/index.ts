/**
 * DB migration over the legacy `ssoProviders` table: materialise an equivalent
 * `ssoConnections` row per org. The runner paginates `ssoProviders` (kept in
 * the schema as the migration source) and both `up`/`down` are idempotent.
 */

import type { MutationCtx } from '../../../../_generated/server';
import type { DbMigration, MigrationDoc } from '../../../framework/types';
import { meta } from './meta';

type RoleSource = 'jobTitle' | 'appRole' | 'group' | 'claim';
type PlatformRole = 'admin' | 'developer' | 'editor' | 'member' | 'disabled';
type ProviderId = 'entra-id' | 'generic-oidc' | 'oauth2';

const ROLE_SOURCES: readonly RoleSource[] = [
  'jobTitle',
  'appRole',
  'group',
  'claim',
];
const ROLES: readonly PlatformRole[] = [
  'admin',
  'developer',
  'editor',
  'member',
  'disabled',
];
const PROVIDER_IDS: readonly ProviderId[] = [
  'entra-id',
  'generic-oidc',
  'oauth2',
];

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
function bool(value: unknown): boolean {
  return value === true;
}
function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}
function isRoleSource(s: string): s is RoleSource {
  return (ROLE_SOURCES as readonly string[]).includes(s);
}
function isRole(s: string): s is PlatformRole {
  return (ROLES as readonly string[]).includes(s);
}
function asProviderId(value: unknown): ProviderId {
  const s = str(value);
  return s && (PROVIDER_IDS as readonly string[]).includes(s)
    ? (s as ProviderId)
    : 'generic-oidc';
}
function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((v): v is string => typeof v === 'string')
    : [];
}

function toRoleRules(value: unknown): {
  source: RoleSource;
  pattern: string;
  targetRole: PlatformRole;
  claim?: string;
}[] {
  if (!Array.isArray(value)) return [];
  const out: {
    source: RoleSource;
    pattern: string;
    targetRole: PlatformRole;
    claim?: string;
  }[] = [];
  for (const entry of value) {
    const rec = record(entry);
    if (!rec) continue;
    const source = str(rec.source);
    const pattern = str(rec.pattern);
    const targetRole = str(rec.targetRole);
    if (!source || !pattern || !targetRole) continue;
    if (!isRoleSource(source) || !isRole(targetRole)) continue;
    const claim = str(rec.claim);
    out.push({ source, pattern, targetRole, ...(claim ? { claim } : {}) });
  }
  return out;
}

async function connectionForOrg(ctx: MutationCtx, organizationId: string) {
  return ctx.db
    .query('ssoConnections')
    .withIndex('by_org', (q) => q.eq('organizationId', organizationId))
    .first();
}

export const migration: DbMigration = {
  meta,
  table: 'ssoProviders',

  async up(ctx: MutationCtx, doc: MigrationDoc) {
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    // Idempotent: one connection per org.
    if (await connectionForOrg(ctx, organizationId)) return;

    const providerId = asProviderId(doc.providerId);
    const features = record(doc.providerFeatures);
    const entra = record(features?.entraId);
    const generic = record(features?.genericOidc);

    const claimMappings = {
      ...(str(generic?.emailClaim) ? { email: str(generic?.emailClaim) } : {}),
      ...(str(generic?.nameClaim) ? { name: str(generic?.nameClaim) } : {}),
      ...(str(generic?.groupsClaim)
        ? { groups: str(generic?.groupsClaim) }
        : {}),
    };

    const now = num(doc.createdAt) ?? num(doc._creationTime) ?? 0;
    await ctx.db.insert('ssoConnections', {
      organizationId,
      protocol: 'oidc',
      displayName: 'Enterprise SSO',
      enabled: true,
      oidcConfig: {
        providerId,
        issuer: str(doc.issuer) ?? '',
        clientIdEncrypted: str(doc.clientIdEncrypted) ?? '',
        clientSecretEncrypted: str(doc.clientSecretEncrypted) ?? '',
        scopes: toStringArray(doc.scopes),
        pkce: providerId === 'generic-oidc',
        ...(Object.keys(claimMappings).length > 0 ? { claimMappings } : {}),
        ...(str(entra?.domainHint)
          ? { domainHint: str(entra?.domainHint) }
          : {}),
        ...(bool(entra?.enableOneDriveAccess)
          ? { enableOneDriveAccess: true }
          : {}),
      },
      autoProvisionRole: bool(doc.autoProvisionRole),
      defaultRole: (() => {
        const r = str(doc.defaultRole);
        return r && isRole(r) ? r : 'member';
      })(),
      roleMappingRules: toRoleRules(doc.roleMappingRules),
      autoProvisionTeam:
        bool(entra?.autoProvisionTeam) || bool(generic?.autoProvisionTeam),
      excludeGroups:
        entra && Array.isArray(entra.excludeGroups)
          ? toStringArray(entra.excludeGroups)
          : toStringArray(generic?.excludeGroups),
      scimEnabled: false,
      scimTokenHash: '',
      scimTokenPrefix: '',
      createdBy: 'system-migration',
      createdAt: now,
      updatedAt: now,
    });
  },

  async down(ctx: MutationCtx, doc: MigrationDoc) {
    const organizationId = str(doc.organizationId);
    if (!organizationId) return;
    const connection = await connectionForOrg(ctx, organizationId);
    // Only roll back a connection this migration created (no SCIM token added
    // afterwards), so a post-migration SCIM setup isn't silently dropped.
    if (
      connection &&
      !connection.scimEnabled &&
      connection.scimTokenHash === ''
    ) {
      await ctx.db.delete(connection._id);
    }
  },
};
