'use node';

/**
 * 0.2.87 / 01 — migrate the legacy per-org `ssoProviders` row to the unified
 * Enterprise SSO connection, now stored as per-org JSON files.
 *
 * The unified feature reads sign-in + provisioning config from
 *   <org>/governance/sso/connection.json          (non-secret config)
 *   <org>/governance/sso/connection.secrets.json  (plaintext secrets)
 * mirrored into the `configCache` table for V8 readers (queries / mutations /
 * auth-hooks) — not from a DB table; the `ssoConnections` table now holds ONLY
 * SCIM token state. This migration carries each existing `ssoProviders` row
 * across so SSO keeps working after cutover — mapping the legacy
 * `providerId`/`issuer`/scopes into the file's `oidc` block, the
 * `roleMappingRules`/`defaultRole`/`providerFeatures` into the shared
 * provisioning policy, and DECRYPTING the encrypted client credentials
 * (stored as compact JWE) back to plaintext for the secrets sidecar.
 *
 * Expand step: leaves `ssoProviders` intact (dropped by a later migration once
 * all deployments have migrated). Idempotent per org: re-running overwrites
 * the same files with the same content. `down` restores the pre-migration
 * `sso/` directory from the fs-tree snapshot captured in `up`.
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
import { defineNodeMigration } from '../../../framework/define';
import type { LegacySsoProviderRow } from './legacy_sso';

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

export const migration = defineNodeMigration({
  title: 'Migrate ssoProviders into the file-based Enterprise SSO connection',
  description:
    'For each org with a legacy ssoProviders row, writes its unified ' +
    'connection.json (protocol oidc/oauth2, oidc block from issuer + scopes + ' +
    'claim/feature mappings, provisioning from roleMappingRules/defaultRole/' +
    'providerFeatures) and a connection.secrets.json with the decrypted client ' +
    'credentials, then re-syncs the configCache mirror. A per-org fs-tree ' +
    'snapshot of the sso/ directory is taken first so down can restore the ' +
    'prior files. Idempotent (re-running overwrites the same files).',
  destructive: false,
  snapshot: 'fs-tree',
  subjects: { tables: ['ssoProviders'], domains: ['governance'] },

  async up(ctx, org, helpers) {
    const dir = resolveSsoDir(org.slug);
    await helpers.snapshotFsTree(dir);

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
    await helpers.restoreFsTree(dir);
    await ctx.runAction(
      internal.enterprise_sso.config.file_actions.syncConnectionCache,
      { organizationId: org.id },
    );
  },
});
