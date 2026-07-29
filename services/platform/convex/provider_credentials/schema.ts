import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * AI-provider credentials — org-owned, MULTIPLE per provider connector. A row
 * pairs one shipped connector (`configs/platform/system/providers/<slug>.yml`)
 * with one way to authenticate against it, discriminated by `authMethod`:
 *
 *  - `api-key`             — a single secret, encrypted at rest with
 *    AES-256-GCM via `lib/secret_box.ts` (`encryptedData`; same primitive as
 *    `projectSecretsTable`).
 *  - `env`                 — a deployment env-var reference; only the NAME is
 *    stored (`envName`), gated by the `TALE_PROVIDER_KEY_` prefix
 *    (`lib/shared/schemas/providers.ts` — fail-closed exfiltration control,
 *    re-checked at read time).
 *  - `subscription-key`    — a static vendor subscription secret (coding-plan
 *    key, portal key, OAuth credentials blob), stored encrypted like an api
 *    key; its forced-execution constraints live on the CONNECTOR's auth
 *    entry, never on the row.
 *  - `subscription-broker` — an external token broker; the whole broker
 *    config (endpoint, response mapping, selection, and the broker's own
 *    secret) is a `brokerCredentialDataSchema` JSON document stored as the
 *    `encryptedData` ciphertext.
 *
 * Secret material NEVER leaves `'use node'` code: queries return metadata
 * plus the write-time `maskedPreview`; plaintext is reachable only through
 * `resolve_credential.ts`.
 */
export const providerAuthMethodValidator = v.union(
  v.literal('api-key'),
  v.literal('env'),
  v.literal('subscription-key'),
  v.literal('subscription-broker'),
);

/** `lib/secret_box.ts` `EncryptedSecret`, as a Convex validator. */
export const encryptedSecretValidator = v.object({
  ciphertext: v.string(),
  nonce: v.string(),
  authTag: v.string(),
  keyFingerprint: v.string(),
});

export const providerCredentialStatusValidator = v.union(
  v.literal('active'),
  v.literal('disabled'),
);

export const providerCredentialsTable = defineTable({
  organizationId: v.string(),
  /** Connector name (`providers/<slug>.yml`); migrated rows may carry a
   * legacy provider name with no matching shipped connector. */
  providerSlug: v.string(),
  authMethod: providerAuthMethodValidator,
  /** Human label, unique per (organization, provider). */
  name: v.string(),
  /** Secret payload for `api-key` (the key itself) and
   * `subscription-broker` (the broker-config JSON document); absent for
   * `env`. */
  encryptedData: v.optional(encryptedSecretValidator),
  /** Env-var NAME for `env`; must satisfy the `TALE_PROVIDER_KEY_` gate. */
  envName: v.optional(v.string()),
  /** Per-credential wire endpoint (https), only for connectors declaring
   * `endpointMode: per-credential` (Azure resource endpoints). Not secret —
   * an endpoint hostname, stored plain for listing. */
  endpointUrl: v.optional(v.string()),
  /** Non-secret display hint computed at write time (first4…last2 of the
   * secret), so listing never touches ciphertext. Absent when the method
   * stores no secret or the secret is too short to mask safely. */
  maskedPreview: v.optional(v.string()),
  /** When present, restricts this credential to the listed catalog model
   * ids; absent means every model the connector offers. */
  modelAllowlist: v.optional(v.array(v.string())),
  /** At most one default per (organization, provider) — the credential
   * resolution falls back to when no explicit credential is selected. */
  isDefault: v.boolean(),
  status: providerCredentialStatusValidator,
  /** User id, or a `migration:<id>` marker for migrated rows. */
  createdBy: v.string(),
  createdAt: v.number(),
  updatedAt: v.number(),
})
  .index('by_org', ['organizationId'])
  .index('by_org_provider', ['organizationId', 'providerSlug']);
