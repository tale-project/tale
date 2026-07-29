import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Pending OAuth2 authorization — one row per `start` redirect, consumed by the
 * matching `callback`.
 *
 * The `state` parameter round-trips through the browser and the vendor, so it
 * is worthless as a carrier of trust: everything the callback needs is kept
 * HERE, server-side, and the browser only ever holds an opaque random token.
 * That makes the three properties the flow depends on structural rather than
 * hopeful:
 *
 *  - unguessable — 256 bits of `crypto.getRandomValues`, never derived from
 *    anything a caller supplied;
 *  - single-use — the consume mutation reads and deletes in ONE transaction,
 *    so two callbacks racing the same token cannot both win;
 *  - expiring — `expiresAt` is checked on consume, and abandoned rows are
 *    swept opportunistically when the next authorization is minted.
 *
 * Only the SHA-256 of the token is stored. A leaked database row therefore
 * cannot be replayed as a state parameter, the same reason session tokens are
 * stored hashed.
 *
 * The row is what binds the resulting credential to a tenant: the callback
 * takes `organizationId` from here, never from the callback request, so a
 * forged callback cannot land a credential in another organization.
 */
export const connectorOauthStatesTable = defineTable({
  /** SHA-256 (hex) of the opaque state token handed to the browser. */
  stateHash: v.string(),
  /** Organization the credential will belong to — verified at mint time. */
  organizationId: v.string(),
  /** Better Auth user id that started the flow; recorded as `createdBy`. */
  userId: v.string(),
  /** Connector directory name (`configs/platform/system/connectors/<slug>/`). */
  connectorSlug: v.string(),
  /**
   * PKCE (RFC 7636) verifier for this authorization. Secret, but never leaves
   * the server and is useless without the matching authorization code, so it
   * lives here in plaintext rather than paying an encryption round-trip on a
   * value whose lifetime is a few minutes.
   */
  codeVerifier: v.string(),
  /**
   * The exact `redirect_uri` sent to the vendor, replayed byte-for-byte at the
   * token exchange (vendors require the two to match). Computed from the
   * deployment's site URL at mint time — never from a request parameter.
   */
  redirectUri: v.string(),
  createdAt: v.number(),
  expiresAt: v.number(),
})
  .index('by_state_hash', ['stateHash'])
  .index('by_expires_at', ['expiresAt']);

/**
 * Inbound Slack routing — which organization a Slack workspace's events belong
 * to.
 *
 * Slack posts every workspace's events to ONE deployment-wide Request URL, and
 * the only tenant discriminator in the payload is `team_id`. This table is that
 * lookup: `team_id` → the organization that installed the app plus the
 * credential holding its bot token. Without a matching row an event is refused,
 * never broadcast — an unknown workspace must not reach any organization's
 * data.
 *
 * A workspace routes to exactly ONE organization. The install path refuses a
 * workspace already claimed by a different org rather than silently re-pointing
 * it, so one tenant can never capture another tenant's inbound Slack traffic.
 */
export const slackTeamRoutesTable = defineTable({
  organizationId: v.string(),
  /** Slack workspace id (`team_id` on every Events API delivery). */
  teamId: v.string(),
  /**
   * The `connectorCredentials` row holding this workspace's bot token. Kept
   * as a plain string rather than a typed id: the credential is written through
   * the credentials domain's own action, which returns its id, and this table
   * has no business reaching into that table directly.
   */
  credentialId: v.string(),
  createdAt: v.number(),
})
  .index('by_team', ['teamId'])
  .index('by_org', ['organizationId']);
