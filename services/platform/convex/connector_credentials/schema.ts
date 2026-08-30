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
