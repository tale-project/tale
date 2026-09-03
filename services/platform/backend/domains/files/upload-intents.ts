import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

/**
 * The app upload-intent ledger (`app.upload_intents`, migration 0067) — the
 * session lanes' twin of the REST door's `rest_upload_intents`.
 *
 * THE INVARIANT: holding or naming a blob ref (`s3:<key>`) grants nothing.
 * `buildObjectKey` mints every org blob as `<prefix>/<orgSlug>/<uuid>`, so
 * the org prefix a key carries proves tenancy (`s3KeyBelongsToOrg`), never
 * ownership — a document's ref is served to every reader of that document.
 * Ownership of an UNBOUND blob is this row: minted by the server for one
 * user and one purpose, consumed exactly once by the bind lane that purpose
 * names. Ownership of a BOUND blob is the row it became (`file_metadata.
 * uploaded_by`) and, for reads, the ACL of the parent it is bound to
 * (`domains/files/access.ts`).
 */

export const UPLOAD_PURPOSES = [
  'file',
  'skill_bundle',
  'automation_bundle',
] as const;
export type UploadPurpose = (typeof UPLOAD_PURPOSES)[number];
export const uploadPurposeSchema = z.enum(UPLOAD_PURPOSES);

/**
 * How long a minted key stays bindable. The presigned PUT itself is valid for
 * 15 minutes, but a slow multi-hundred-MB upload that started inside that
 * window may run far longer, and the bind follows the upload — so the intent
 * outlives the PUT by a wide margin. Single-use and per-user, so the long
 * window costs nothing.
 */
export const UPLOAD_INTENT_TTL_MS = 2 * 60 * 60_000;

export interface UploadIntentKey {
  organizationId: string;
  userId: string;
  storageRef: string;
}

/**
 * Record that `storageRef` was minted for `userId` and `purpose`. Called by
 * the mint lanes right after the key is minted (and, for the byte lane,
 * after the bytes landed). Sweeps the org's dead handshakes lazily.
 */
export async function recordUploadIntent(
  sql: Sql | TransactionSql,
  args: UploadIntentKey & { purpose: UploadPurpose },
): Promise<void> {
  const now = Date.now();
  await sql`
    INSERT INTO app.upload_intents (
      org_id, user_id, purpose, s3_ref, expires_at_ms, created_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.userId}, ${args.purpose},
      ${args.storageRef}, ${now + UPLOAD_INTENT_TTL_MS}, ${now}
    )
  `;
  // Consumed rows, or rows expired a day ago, are dead handshakes.
  await sql`
    DELETE FROM app.upload_intents
    WHERE org_id = ${args.organizationId}
      AND (consumed_at_ms IS NOT NULL
        OR expires_at_ms < ${now - 24 * 3_600_000})
  `;
}

/**
 * Consume the single-use intent for `storageRef`: true when a matching
 * unconsumed, unexpired row existed for this org, user and purpose (and is
 * now consumed), false otherwise — a foreign ref, a re-used ref and an
 * expired handshake are indistinguishable by design. `purpose` `undefined`
 * accepts any purpose: the reclaim lane only has to prove the upload was
 * the caller's.
 */
export async function consumeUploadIntent(
  sql: Sql | TransactionSql,
  args: UploadIntentKey & { purpose?: UploadPurpose },
): Promise<boolean> {
  const now = Date.now();
  const rows = await sql<{ id: string }[]>`
    UPDATE app.upload_intents SET consumed_at_ms = ${now}
    WHERE s3_ref = ${args.storageRef}
      AND org_id = ${args.organizationId}
      AND user_id = ${args.userId}
      AND ${
        args.purpose === undefined ? sql`TRUE` : sql`purpose = ${args.purpose}`
      }
      AND consumed_at_ms IS NULL
      AND expires_at_ms > ${now}
    RETURNING id
  `;
  return rows.length > 0;
}

/**
 * Non-consuming ownership proof for a client-named ref: the caller minted it
 * (an intent row inside its TTL, consumed or not) or is the registered
 * uploader of the row it became. For lanes that legitimately bind one blob
 * more than once — a document upload creates one document per selected team
 * from one blob — and for lanes that only READ the named blob on the
 * caller's behalf (an outbound mail attachment).
 */
export async function ownsUploadedBlob(
  sql: Sql | TransactionSql,
  args: UploadIntentKey,
): Promise<boolean> {
  const rows = await sql<{ owned: boolean }[]>`
    SELECT EXISTS (
      SELECT 1 FROM app.upload_intents
      WHERE s3_ref = ${args.storageRef}
        AND org_id = ${args.organizationId}
        AND user_id = ${args.userId}
        AND expires_at_ms > ${Date.now()}
    ) OR EXISTS (
      SELECT 1 FROM app.file_metadata
      WHERE org_id = ${args.organizationId}
        AND storage_ref = ${args.storageRef}
        AND uploaded_by = ${args.userId}
    ) AS owned
  `;
  return rows[0]?.owned ?? false;
}

/** The first of `storageRefs` the caller does NOT own, or null when all are theirs. */
export async function firstForeignUpload(
  sql: Sql | TransactionSql,
  scope: { organizationId: string; userId: string },
  storageRefs: readonly string[],
): Promise<string | null> {
  for (const storageRef of new Set(storageRefs)) {
    if (!(await ownsUploadedBlob(sql, { ...scope, storageRef }))) {
      return storageRef;
    }
  }
  return null;
}
