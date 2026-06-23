import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import {
  oidcStoredConfigValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  samlStoredConfigValidator,
  ssoProtocolValidator,
  ssoResourceTypeValidator,
} from './validators';

/**
 * Unified Enterprise SSO + Provisioning — at most ONE connection per org.
 *
 * Replaces `ssoProviders`, `scimProvisioning`, and `scimLinks`. Holds the
 * sign-in config (OIDC / OAuth2 / SAML, protocol-discriminated), the shared
 * provisioning policy (role mapping + group→team sync), and the inbound SCIM
 * bearer token. Secrets are encrypted; the SCIM token is stored only as a
 * SHA-256 hash and resolves the org for inbound SCIM requests.
 */
export const ssoConnectionsTable = defineTable({
  organizationId: v.string(),
  // Optional: a connection may provision via SCIM with no sign-in protocol
  // configured yet (and vice-versa). Set once a sign-in protocol is chosen.
  protocol: v.optional(ssoProtocolValidator),
  displayName: v.string(),
  // Sign-in (SSO) enabled. SCIM has its own `scimEnabled` flag.
  enabled: v.boolean(),
  // Optional email-domain routing (sign-in by domain).
  domain: v.optional(v.string()),

  // Exactly one of these is set, matching `protocol`.
  oidcConfig: v.optional(oidcStoredConfigValidator),
  samlConfig: v.optional(samlStoredConfigValidator),

  // Shared provisioning policy (applies to SSO login + SCIM).
  autoProvisionRole: v.boolean(),
  defaultRole: platformRoleValidator,
  roleMappingRules: v.array(roleMappingRuleValidator),
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),

  // SCIM provisioning (inbound). Token stored as a SHA-256 hash only.
  scimEnabled: v.boolean(),
  scimTokenHash: v.string(),
  scimTokenPrefix: v.string(),
  scimTokenGeneratedAt: v.optional(v.number()),
  scimLastUsedAt: v.optional(v.number()),

  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_scimTokenHash', ['scimTokenHash'])
  .index('by_domain', ['domain']);

/**
 * Per-resource provisioning state (was `scimLinks`). Keeps Better Auth's
 * `user`/`team` rows untouched while letting us round-trip the IdP's
 * externalId and restore a SCIM-deactivated user's prior role.
 */
export const ssoProvisioningLinksTable = defineTable({
  organizationId: v.string(),
  resourceType: ssoResourceTypeValidator,
  internalId: v.string(),
  externalId: v.optional(v.string()),
  lastActiveRole: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org_internal', ['organizationId', 'internalId'])
  .index('by_org_external', ['organizationId', 'externalId'])
  .index('by_org_type', ['organizationId', 'resourceType']);
