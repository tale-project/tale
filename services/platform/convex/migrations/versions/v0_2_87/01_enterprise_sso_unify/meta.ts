import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.87 / 01 — migrate the legacy per-org `ssoProviders` row to the unified
 * Enterprise SSO connection, now stored as per-org JSON files.
 *
 * The unified Enterprise SSO feature reads sign-in + provisioning config from
 * per-org files (`<org>/governance/sso/connection.json` and its
 * `connection.secrets.json` sidecar), mirrored into the `configCache` table for
 * V8 readers. The `ssoConnections` DB table now holds ONLY SCIM token state.
 * This migration carries each existing `ssoProviders` row across so SSO keeps
 * working after cutover — mapping the legacy `providerId`/`issuer`/scopes into
 * the file's `oidc` block, the `roleMappingRules`/`defaultRole`/
 * `providerFeatures` into the shared provisioning policy, and DECRYPTING the
 * encrypted client credentials into the plaintext secrets sidecar.
 *
 * Expand step: leaves `ssoProviders` intact (dropped by a later migration once
 * all deployments have migrated). Per-org node migration — idempotent (re-running
 * overwrites the same files), and reversible from an fs-tree snapshot of the
 * org's `sso/` directory taken before `up` (`down` restores it).
 */
export const meta: MigrationMeta = {
  id: '0.2.87/01_enterprise_sso_unify',
  semver: '0.2.87',
  numericId: 1,
  slug: 'enterprise_sso_unify',
  title: 'Migrate ssoProviders into the file-based Enterprise SSO connection',
  description:
    'For each org with a legacy ssoProviders row, writes its unified ' +
    'connection.json (protocol oidc/oauth2, oidc block from issuer + scopes + ' +
    'claim/feature mappings, provisioning from roleMappingRules/defaultRole/' +
    'providerFeatures) and a connection.secrets.json with the decrypted client ' +
    'credentials, then re-syncs the configCache mirror. A per-org fs-tree ' +
    'snapshot of the sso/ directory is taken first so down can restore the ' +
    'prior files. Idempotent (re-running overwrites the same files).',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'fs-tree',
};
