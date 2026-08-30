import { z } from 'zod/v4';

/**
 * Per-organization "bring your own object storage" for file blobs.
 *
 * An org may route ALL of its uploaded blobs — Knowledge-Hub documents, chat
 * attachments, audio, TTS, video-link media, thread/workspace files, agent
 * knowledge, task/email attachments, generated images — at its OWN
 * S3-compatible bucket (AWS S3, MinIO, Cloudflare R2, Wasabi, …) instead of the
 * deployment's Convex `_storage`. Combined with the per-org knowledge Postgres
 * (`knowledge/connection.json`), this puts EVERY layer of an org's data — source
 * blobs, extracted text, chunks, embeddings — physically in the org's own
 * infrastructure. Absent this config, the org's blobs stay on the deployment
 * default (Convex `_storage`), scoped per-org logically (today's behaviour, zero
 * regression).
 *
 * TENANT ISOLATION: a per-org bucket is dedicated to one org and MUST NEVER be
 * addressed for another org — the resolver keys strictly by orgSlug, never a
 * client-supplied value. See AGENTS.md → "Tenant isolation".
 *
 * File-based config domain like `knowledge`/`sso`: admin-created on demand, one
 * file per org, no builtin catalog. On disk (mirrors `knowledge`):
 *   {TALE_CONFIG_DIR}/<orgSlug>/object-storage/connection.json          (config)
 *   {TALE_CONFIG_DIR}/<orgSlug>/object-storage/connection.secrets.json  (SOPS)
 *
 * The bucket SHAPE reuses the S3 fields the deployment-wide
 * `dataStores.convexStorage` already uses (region/endpoint/forcePathStyle) — a
 * single bucket rather than Convex's five, since one org owns the whole bucket.
 * Credentials (`accessKeyId`/`secretAccessKey`) live ONLY in the SOPS-encrypted
 * secrets sidecar, exactly like `providers/*.secrets.json`.
 */

export const OBJECT_STORAGE_CONFIG_DOMAIN = 'object-storage';
export const OBJECT_STORAGE_CONNECTION_KEY = 'connection';

/**
 * `connection.json` — the org's S3-compatible bucket coordinates. Reuses the
 * `dataStores.convexStorage` S3 shape (region + optional endpoint +
 * forcePathStyle), narrowed to ONE bucket the org owns.
 */
export const objectStorageConnectionFileSchema = z
  .object({
    region: z.string().min(1),
    /**
     * S3-compatible endpoint (MinIO/R2/Wasabi). Omit for AWS S3 proper.
     * Restricted to http(s):// — `.url()` alone also admits
     * file:/javascript:/ftp:, and the SSRF host gate only checks the hostname,
     * so a non-http scheme with a public host would otherwise reach the signer.
     * Mirrors `convexStorageSchema` in deployment.ts.
     */
    endpoint: z
      .string()
      .url()
      .refine((u) => {
        try {
          const p = new URL(u).protocol;
          return p === 'https:' || p === 'http:';
        } catch {
          return false;
        }
      }, 'Endpoint must be http(s)://')
      .optional(),
    /** Path-style addressing (`endpoint/bucket/key`) — required by MinIO and
     * most non-AWS stores; AWS S3 uses virtual-host style (the default). */
    forcePathStyle: z.boolean().default(false),
    bucket: z.string().min(1),
    /**
     * Optional key prefix inside the bucket. Lets an org share one bucket
     * across, say, staging/prod, or namespace Tale's blobs beside other data.
     * Empty ⇒ blobs live at the bucket root. Never used for cross-org scoping
     * (a per-org bucket is already dedicated); purely an org-chosen namespace.
     */
    prefix: z.string().optional(),
    /**
     * Where a BROWSER reaches this store, when that differs from `endpoint`.
     *
     * The bundled store the stack ships is internal-only — `object-store:9000`
     * resolves inside the compose network and nowhere else — while presigned
     * PUT/GET URLs are handed to the browser by design (direct transfer, and
     * the store, not Node, answers Range requests for media seeking). So the
     * backend signs browser-facing URLs against this origin instead, and the
     * proxy forwards `/<bucket>/*` to the store. Signing covers the host and
     * the path, and the proxy rewrites neither, so the signature still
     * verifies at the store.
     *
     * Absent for a BYO bucket, whose endpoint is already public — and absent
     * is the safe default: a store nobody published stays unreachable rather
     * than being guessed at.
     */
    publicEndpoint: z
      .string()
      .url()
      .refine((u) => {
        try {
          const p = new URL(u).protocol;
          return p === 'https:' || p === 'http:';
        } catch {
          return false;
        }
      }, 'Public endpoint must be http(s)://')
      .optional(),
  })
  .strict();
export type ObjectStorageConnectionFile = z.infer<
  typeof objectStorageConnectionFileSchema
>;

/**
 * `connection.secrets.json` — the S3 credentials sidecar. SOPS-encrypted at
 * rest when a SOPS age key is configured; plaintext JSON otherwise (same hybrid
 * model as `providers`/`knowledge`). Both keys are required together — an
 * S3-compatible store always needs a key pair (there is no passwordless
 * equivalent to Postgres peer auth here).
 */
export const objectStorageConnectionSecretsSchema = z
  .object({
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  })
  .strict();
export type ObjectStorageConnectionSecrets = z.infer<
  typeof objectStorageConnectionSecretsSchema
>;
