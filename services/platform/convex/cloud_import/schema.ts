import { defineTable } from 'convex/server';
import { v } from 'convex/values';

import { encryptedSecretValidator } from '../connector_credentials/schema';

/**
 * Cloud providers a member may authorize for Knowledge import/sync.
 * Distinct from org connectors (shared credentials) and from login identity.
 */
export const cloudImportProviderValidator = v.union(
  v.literal('onedrive'),
  v.literal('google-drive'),
);

export type CloudImportProvider = 'onedrive' | 'google-drive';

/**
 * Per-user cloud authorization for Knowledge Documents.
 *
 * One row per (organization, user, provider). Tokens are sealed with
 * `lib/secret_box` — the same envelope connector credentials use. The grant
 * is intentional ("authorize OneDrive for importing into Documents"), not a
 * side effect of signing in with Microsoft/Google and not an org-wide
 * connector credential agents can share.
 *
 * Tenant isolation: every read filters `organizationId`; ownership further
 * requires `userId` matching the acting member. Agents must not resolve these
 * rows — only Knowledge import/sync paths owned by that user.
 */
export const userCloudAuthorizationsTable = defineTable({
  organizationId: v.string(),
  userId: v.string(),
  provider: cloudImportProviderValidator,
  /**
   * OAuth2 payload JSON encrypted as one document:
   * `{ accessToken, refreshToken?, expiresAt?, scopes? }`.
   */
  encryptedData: encryptedSecretValidator,
  /** Scopes the vendor reported at grant time (non-secret). */
  scopes: v.array(v.string()),
  /** Optional account label from the provider (e.g. Graph mail) for UI. */
  accountLabel: v.optional(v.string()),
  status: v.union(
    v.literal('active'),
    v.literal('needs-reauth'),
    v.literal('revoked'),
  ),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org_user_provider', ['organizationId', 'userId', 'provider'])
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_user', ['userId']);

/**
 * Pending cloud-import OAuth2 authorizations — mirror of
 * `connectorOauthStates`, keyed by provider instead of connector slug.
 */
export const cloudImportOauthStatesTable = defineTable({
  stateHash: v.string(),
  organizationId: v.string(),
  userId: v.string(),
  provider: cloudImportProviderValidator,
  codeVerifier: v.string(),
  redirectUri: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index('by_state_hash', ['stateHash'])
  .index('by_expires_at', ['expiresAt']);
