'use node';

/**
 * Node migration: export each org's legacy `ssoProviders` row to the per-org
 * JSON files that are now the source of truth for the unified Enterprise SSO
 * connection, then re-sync the `configCache` mirror so V8 readers (queries /
 * mutations / auth-hooks) see the file immediately.
 *
 * The unified feature reads sign-in config from
 *   <org>/governance/sso/connection.json          (non-secret config)
 *   <org>/governance/sso/connection.secrets.json  (plaintext secrets)
 * not from a DB table — the `ssoConnections` table now holds ONLY SCIM token
 * state. So this migration maps the legacy row into a `SsoConnectionFile` plus a
 * `SsoConnectionSecrets`, DECRYPTING the legacy `clientIdEncrypted` /
 * `clientSecretEncrypted` (stored as compact JWE) back to plaintext for the
 * secrets sidecar.
 *
 * Idempotent per org: re-running overwrites the same files with the same
 * content. `down` restores the pre-migration `sso/` directory from the fs-tree
 * snapshot captured in `up`.
 */

import type {
  ProvisioningPolicy,
  PlatformRole as SchemaPlatformRole,
  RoleMappingRule,
  SsoConnectionFile,
  SsoConnectionSecrets,
} from '../../../../../lib/shared/schemas/enterprise_sso';
import { internal } from '../../../../_generated/api';
import {
  resolveSsoConnectionFilePath,
  resolveSsoConnectionSecretsFilePath,
  resolveSsoDir,
  serializeSsoConnectionJson,
  serializeSsoSecretsJson,
} from '../../../../enterprise_sso/file_utils';
import { decryptString } from '../../../../lib/crypto/decrypt_string';
import type { NodeMigration } from '../../../framework/types';
import type { LegacySsoProviderRow } from './legacy_sso';
import { meta } from './meta';

type RoleSource = RoleMappingRule['source'];
type ProviderId = SsoConnectionFile['oidc'] extends infer O
  ? O extends { providerId: infer P }
    ? P
    : never
  : never;

const ROLE_SOURCES: readonly RoleSource[] = [
  'jobTitle',
  'appRole',
  'group',
  'claim',
];
const ROLES: readonly SchemaPlatformRole[] = [
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

function isRoleSource(s: string): s is RoleSource {
  return (ROLE_SOURCES as readonly string[]).includes(s);
}
function isRole(s: string): s is SchemaPlatformRole {
  return (ROLES as readonly string[]).includes(s);
}
function asProviderId(value: string): ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value)
    ? (value as ProviderId)
    : 'generic-oidc';
}

/** Map the legacy role-mapping rules, dropping any with an unknown source/role. */
function toRoleRules(
  rules: LegacySsoProviderRow['roleMappingRules'],
): RoleMappingRule[] {
  const out: RoleMappingRule[] = [];
  for (const r of rules ?? []) {
    if (!r.source || !r.pattern || !r.targetRole) continue;
    if (!isRoleSource(r.source) || !isRole(r.targetRole)) continue;
    out.push({
      source: r.source,
      pattern: r.pattern,
      targetRole: r.targetRole,
      ...(r.claim ? { claim: r.claim } : {}),
    });
  }
  return out;
}

/**
 * Decrypt a stored compact-JWE credential back to plaintext. Empty / missing
 * values stay empty (the legacy row carried `''` when unset). Surfaces decrypt
 * failures rather than silently writing a corrupt secret.
 */
async function decryptOrEmpty(encrypted: string | undefined): Promise<string> {
  if (!encrypted) return '';
  return decryptString(encrypted);
}

export const migration: NodeMigration = {
  meta,

  async up(ctx, org, helpers) {
    const dir = resolveSsoDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

    const row: LegacySsoProviderRow | null = await ctx.runQuery(
      internal.migrations.versions.v0_2_87['01_enterprise_sso_unify'].legacy_sso
        .getSsoProviderByOrg,
      { organizationId: org.id },
    );
    // No legacy SSO for this org — nothing to carry across. Idempotent no-op.
    if (!row) return;

    const providerId = asProviderId(row.providerId);
    const entra = row.providerFeatures?.entraId;
    const generic = row.providerFeatures?.genericOidc;

    const claimMappings = {
      ...(generic?.emailClaim ? { email: generic.emailClaim } : {}),
      ...(generic?.nameClaim ? { name: generic.nameClaim } : {}),
      ...(generic?.groupsClaim ? { groups: generic.groupsClaim } : {}),
    };

    const defaultRole: SchemaPlatformRole = isRole(row.defaultRole)
      ? row.defaultRole
      : 'member';

    const provisioning: ProvisioningPolicy = {
      autoProvisionRole: row.autoProvisionRole,
      defaultRole,
      roleMappingRules: toRoleRules(row.roleMappingRules),
      autoProvisionTeam:
        entra?.autoProvisionTeam === true ||
        generic?.autoProvisionTeam === true,
      excludeGroups: entra?.excludeGroups ?? generic?.excludeGroups ?? [],
    };

    const connection: SsoConnectionFile = {
      enabled: true,
      // The legacy model is OIDC/OAuth2 only (no SAML); preserve the OAuth2
      // distinction, default everything else to oidc.
      protocol: providerId === 'oauth2' ? 'oauth2' : 'oidc',
      displayName: 'Enterprise SSO',
      oidc: {
        providerId,
        issuer: row.issuer ?? '',
        scopes: row.scopes ?? [],
        pkce: providerId === 'generic-oidc',
        ...(Object.keys(claimMappings).length > 0 ? { claimMappings } : {}),
        ...(entra?.domainHint ? { domainHint: entra.domainHint } : {}),
        ...(entra?.enableOneDriveAccess ? { enableOneDriveAccess: true } : {}),
      },
      provisioning,
    };

    const clientId = await decryptOrEmpty(row.clientIdEncrypted);
    const clientSecret = await decryptOrEmpty(row.clientSecretEncrypted);
    const secrets: SsoConnectionSecrets = {
      ...(clientId ? { clientId } : {}),
      ...(clientSecret ? { clientSecret } : {}),
    };

    await helpers.atomicWrite(
      resolveSsoConnectionFilePath(org.slug),
      serializeSsoConnectionJson(connection),
    );
    await helpers.atomicWrite(
      resolveSsoConnectionSecretsFilePath(org.slug),
      serializeSsoSecretsJson(secrets),
    );

    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.syncConnectionCache,
      { organizationId: org.id },
    );
  },

  async down(ctx, org, helpers) {
    const dir = resolveSsoDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.syncConnectionCache,
      { organizationId: org.id },
    );
  },
};
