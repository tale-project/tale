import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { ssoResourceTypeValidator } from './validators';

/**
 * Inbound SCIM token state — at most ONE row per org.
 *
 * The org's sign-in + provisioning CONFIGURATION lives in per-org JSON files
 * (`<orgSlug>/governance/sso/connection.json`, mirrored into `configCache`),
 * NOT here. This DB row holds only the inbound SCIM bearer token (stored as a
 * SHA-256 hash) plus its runtime state, because resolving an inbound SCIM
 * request to its org is a reverse lookup by token hash — which needs a DB
 * index and cannot be served from per-org files.
 */
export const ssoConnectionsTable = defineTable({
  organizationId: v.string(),

  // SCIM provisioning (inbound). Token stored as a SHA-256 hash only; the hash
  // resolves the org for inbound SCIM requests. Provisioning POLICY (default
  // role, role mapping, team sync) lives in the connection config file.
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
  .index('by_scimTokenHash', ['scimTokenHash']);

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
