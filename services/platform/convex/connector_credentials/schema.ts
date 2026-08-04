import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Connector credentials — org-owned, MULTIPLE per connector. A row pairs one
 * shipped connector (`configs/platform/system/connectors/<slug>/connector.yml`)
 * with one way to authenticate against it, discriminated by `authMethod` and
 * matching an `auth[]` entry the connector declares:
 *
 *  - `api-key` — a single secret the live body places itself (a query param or
 *    a vendor header such as Shopify's `X-Shopify-Access-Token`).
 *  - `bearer`  — a token the platform injects as
 *    `Authorization: <scheme> <token>`, where the scheme comes from the
 *    connector's auth entry (`Bearer` by default; Discord bot tokens use
 *    `Bot`).
 *  - `basic`   — username + password, injected as HTTP Basic. Also the shape
 *    an SMTP/IMAP login and a WebDAV app password take.
 *  - `oauth2`  — an authorization-code grant: access token, optional refresh
 *    token, expiry, and the granted scopes.
 *
 * Secret material NEVER leaves `'use node'` code: queries return metadata plus
 * the write-time `maskedPreview`; plaintext is reachable only through
 * `resolve_credential.ts`. Everything secret lives inside the single
 * `encryptedData` envelope (AES-256-GCM via `lib/secret_box.ts`) rather than
 * per-method columns, so adding a method never reshapes the table and no code
 * path can read a secret without going through the one decrypt seam.
 *
 * Cardinality is the headline fix: the retired table hard-threw on a second
 * row per (organization, slug). Here a connector may hold many credentials —
 * a workflow node or chat invocation names one via `credential`, and omitting
 * it selects the org default for that connector.
 */
export const connectorAuthMethodValidator = v.union(
  v.literal('api-key'),
  v.literal('bearer'),
  v.literal('basic'),
  v.literal('oauth2'),
);

/** `lib/secret_box.ts` `EncryptedSecret`, as a Convex validator. */
export const encryptedSecretValidator = v.object({
  ciphertext: v.string(),
  nonce: v.string(),
  authTag: v.string(),
  keyFingerprint: v.string(),
});

/**
 * `disabled` is an operator decision; `needs-reauth` is the system's — an
 * oauth2 grant whose refresh failed. They are distinct because only the second
 * one is fixed by re-running the consent flow, and the settings UI must say
 * which is which instead of showing one ambiguous "broken" state.
 */
export const connectorCredentialStatusValidator = v.union(
  v.literal('active'),
  v.literal('disabled'),
  v.literal('needs-reauth'),
);

export const connectorCredentialsTable = defineTable({
  organizationId: v.string(),
  /** Connector name — the `connectors/<slug>/` directory, which is also the
   * `<connector>` half of the engine node type `<connector>.<action>`. */
  connectorSlug: v.string(),
  authMethod: connectorAuthMethodValidator,
  /** Human label, unique per (organization, connector). */
  name: v.string(),
  /**
   * The method's secret payload, encrypted as one JSON document:
   *  - `api-key`/`bearer` → `{ token }`
   *  - `basic`            → `{ username, password, smtpUsername?, smtpPassword? }`
   *    (the optional SMTP pair is for imap-smtp's separate-provider relay)
   *  - `oauth2`           → `{ accessToken, refreshToken?, expiresAt?, scopes? }`
   */
  encryptedData: encryptedSecretValidator,
  /**
   * Per-credential API origin (https, no trailing slash) for connectors
   * declaring `endpointMode: per-credential` — the Atlassian site for
   * Confluence, the merchant store for Shopify. Live bodies read it as
   * `ctx.endpoint`. Not secret: an origin, stored plain so listings can show
   * which instance a credential points at.
   */
  endpointUrl: v.optional(v.string()),
  /** The connector's non-secret per-credential settings, keyed by the
   * connector's `configFields` keys (a mail server host and port, an API
   * version). Stored plain — these are not secrets — and passed to a live or
   * native body as `ctx.config`. Absent for connectors that declare none. */
  config: v.optional(
    v.record(v.string(), v.union(v.string(), v.number(), v.boolean())),
  ),
  /** Non-secret display hint computed at write time, so listing never touches
   * ciphertext. Absent when the secret is too short to mask safely. */
  maskedPreview: v.optional(v.string()),
  /** At most one default per (organization, connector) — what resolution
   * falls back to when an invocation names no credential. */
  isDefault: v.boolean(),
  /**
   * Per-credential mail-sync watermarks (epoch ms). `conversation.sync_mailbox`
   * advances these after each pass so every active mailbox on a connector
   * keeps its own cursor — a shared connector-level cursor would skip older
   * mail on a newly added credential.
   */
  mailSyncInboundSince: v.optional(v.number()),
  mailSyncOutboundSince: v.optional(v.number()),
  status: connectorCredentialStatusValidator,
  /** Set when an oauth2 refresh fails, so the UI can explain the failure
   * instead of only flagging the status. */
  statusDetail: v.optional(v.string()),
  /** User id, or a `migration:<id>` marker for migrated rows. */
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_connector', ['organizationId', 'connectorSlug']);
