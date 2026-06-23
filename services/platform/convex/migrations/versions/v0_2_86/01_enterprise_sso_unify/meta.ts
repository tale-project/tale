import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.86 / 01 — migrate the legacy per-org `ssoProviders` row to the unified
 * `ssoConnections` model.
 *
 * The unified Enterprise SSO feature reads sign-in config from `ssoConnections`
 * (protocol-discriminated OIDC/OAuth2/SAML + provisioning + SCIM); login routes
 * were repointed to it. This migration carries each existing `ssoProviders` row
 * across so SSO keeps working after cutover — mapping the legacy
 * `providerId`/`issuer`/encrypted-credentials into `oidcConfig`, and the
 * `roleMappingRules`/`defaultRole`/`providerFeatures` into the shared
 * provisioning policy. The encrypted secrets are copied verbatim (no decrypt).
 *
 * Expand step: leaves `ssoProviders` intact (dropped by a later migration once
 * all deployments have migrated). Idempotent — skips an org that already has a
 * connection. Reversible — `down` deletes the connection created for the org.
 */
export const meta: MigrationMeta = {
  id: '0.2.86/01_enterprise_sso_unify',
  semver: '0.2.86',
  numericId: 1,
  slug: 'enterprise_sso_unify',
  title: 'Migrate ssoProviders into the unified ssoConnections model',
  description:
    'For each legacy ssoProviders row, inserts an equivalent ssoConnections ' +
    'row (protocol "oidc", oidcConfig from issuer + encrypted client ' +
    'credentials, provisioning from roleMappingRules/defaultRole/' +
    'providerFeatures). Idempotent (skips orgs that already have a ' +
    'connection). down deletes the migrated connection for the org.',
  kind: 'db',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
