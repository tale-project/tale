import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import {
  parseBlobRef,
  s3KeyBelongsToOrg,
} from '../../core/lib/storage/blob_ref.ts';
import { resolveObjectStore, s3DeleteObject } from '../../lib/object-store.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';

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
 *
 * The row is also the only record that the blob EXISTS: a key the browser
 * never PUT to, or PUT to and never bound, has no file row for the row-
 * driven sweeps to find. `sweepUploadIntents` reclaims those bytes lazily
 * from the mint path (lazy cleanup over cron, the house rule).
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

/**
 * How long past its TTL an unconsumed, unvouched-for intent may sit before
 * its blob counts as ABANDONED and is reclaimed. Nothing can still bind it
 * (the PUT died 15 minutes in, the intent two hours in); the day is slack
 * for a bind lane that proved ownership in a transaction still committing.
 */
export const ABANDONED_UPLOAD_GRACE_MS = 24 * 3_600_000;

/** Blobs reclaimed per sweep — bounded work on a request path; a backlog
 * drains over the following mints. */
const RECLAIM_BATCH = 25;

/** The two ledgers the sweep serves: the session lanes' and the REST door's
 * (0033). Only the session ledger carries `bound_at_ms` — the REST bind
 * always consumes, so there a row is either consumed or nobody's. */
export type UploadIntentLedger =
  | 'app.upload_intents'
  | 'app.rest_upload_intents';

export interface UploadIntentKey {
  organizationId: string;
  userId: string;
  storageRef: string;
}

/**
 * Record that `storageRef` was minted for `userId` and `purpose`. Called by
 * the mint lanes right after the key is minted (and, for the byte lane,
 * after the bytes landed). Sweeps the org's dead handshakes and abandoned
 * uploads lazily — the sweep is bookkeeping, so its failure is logged and
 * never fails the mint: the intent row is already the record that the blob
 * exists, and the next mint sweeps again.
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
  try {
    await sweepUploadIntents(sql, { organizationId: args.organizationId });
  } catch (error) {
    console.warn(
      '[files] upload-intent sweep failed; the intent is recorded, the sweep retries on the next mint:',
      error instanceof Error ? error.message : error,
    );
  }
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
 *
 * The intent arm STAMPS the row (`bound_at_ms`): this proof does not
 * consume, so the stamp is the only trace that somebody bound or sent the
 * blob — and the abandoned-upload sweep must never reclaim a ref that was
 * vouched for. A stamp inside a bind transaction rolls back with a refusal.
 */
export async function ownsUploadedBlob(
  sql: Sql | TransactionSql,
  args: UploadIntentKey,
): Promise<boolean> {
  const now = Date.now();
  const stamped = await sql<{ id: string }[]>`
    UPDATE app.upload_intents SET bound_at_ms = coalesce(bound_at_ms, ${now})
    WHERE s3_ref = ${args.storageRef}
      AND org_id = ${args.organizationId}
      AND user_id = ${args.userId}
      AND expires_at_ms > ${now}
    RETURNING id
  `;
  if (stamped.length > 0) return true;
  const rows = await sql<{ owned: boolean }[]>`
    SELECT EXISTS (
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

/**
 * The mint path's lazy sweep of one org's ledger:
 *
 *  1. consumed rows are dead handshakes — the bind lane owns the blob now;
 *  2. rows expired past the grace whose blob SOMEBODY holds (a file row, or
 *     a non-consuming proof stamped `bound_at_ms`) drop the same way: the
 *     blob's lifecycle belongs to whatever holds it;
 *  3. what is left past the grace is ABANDONED — minted, maybe PUT, never
 *     bound, never vouched for — and nothing else will ever find it: the
 *     bytes are reclaimed, then the row. A failed delete keeps the row, so
 *     a later sweep retries; a bounded batch keeps the mint request cheap.
 *
 * Never reclaims a blob that got bound: a bound blob is either consumed (1),
 * vouched for (2), or carried by a file row (2).
 */
export async function sweepUploadIntents(
  sql: Sql | TransactionSql,
  args: { organizationId: string; ledger?: UploadIntentLedger },
): Promise<{ reclaimed: number }> {
  const ledgerName: UploadIntentLedger = args.ledger ?? 'app.upload_intents';
  const ledger = sql.unsafe(ledgerName);
  const vouchedFor =
    ledgerName === 'app.upload_intents'
      ? sql`i.bound_at_ms IS NOT NULL`
      : sql`FALSE`;
  const now = Date.now();
  const horizon = now - ABANDONED_UPLOAD_GRACE_MS;

  await sql`
    DELETE FROM ${ledger}
    WHERE org_id = ${args.organizationId} AND consumed_at_ms IS NOT NULL
  `;
  await sql`
    DELETE FROM ${ledger} i
    WHERE i.org_id = ${args.organizationId}
      AND i.consumed_at_ms IS NULL
      AND i.expires_at_ms < ${horizon}
      AND (${vouchedFor} OR EXISTS (
        SELECT 1 FROM app.file_metadata m
        WHERE m.org_id = i.org_id AND m.storage_ref = i.s3_ref
      ))
  `;
  const abandoned = await sql<{ id: string; s3Ref: string }[]>`
    SELECT i.id, i.s3_ref AS "s3Ref" FROM ${ledger} i
    WHERE i.org_id = ${args.organizationId}
      AND i.consumed_at_ms IS NULL
      AND i.expires_at_ms < ${horizon}
      AND NOT (${vouchedFor})
      AND NOT EXISTS (
        SELECT 1 FROM app.file_metadata m
        WHERE m.org_id = i.org_id AND m.storage_ref = i.s3_ref
      )
    ORDER BY i.expires_at_ms
    LIMIT ${RECLAIM_BATCH}
  `;
  if (abandoned.length === 0) return { reclaimed: 0 };

  let orgSlug: string | null;
  let store: Awaited<ReturnType<typeof resolveObjectStore>>;
  try {
    orgSlug = await resolveOrgSlug(sql, args.organizationId);
    if (orgSlug === null) return { reclaimed: 0 };
    store = await resolveObjectStore(orgSlug);
  } catch (error) {
    console.warn(
      '[files] abandoned-upload reclaim skipped (store unresolved):',
      error instanceof Error ? error.message : error,
    );
    return { reclaimed: 0 };
  }
  let reclaimed = 0;
  for (const row of abandoned) {
    const key = orgScopedKey(row.s3Ref, orgSlug);
    if (key === null) {
      // Not a key this org's mint could have produced — nothing to reclaim,
      // and a row that can never be acted on must not be retried forever.
      console.warn(
        `[files] abandoned-upload row ${row.id} names a ref outside the org namespace; dropping it`,
      );
      await sql`DELETE FROM ${ledger} WHERE id = ${row.id}`;
      continue;
    }
    try {
      await s3DeleteObject(store, key);
    } catch (error) {
      console.warn(
        `[files] abandoned-upload delete failed for ${key}:`,
        error instanceof Error ? error.message : error,
      );
      continue;
    }
    await sql`DELETE FROM ${ledger} WHERE id = ${row.id}`;
    reclaimed += 1;
  }
  return { reclaimed };
}

function orgScopedKey(ref: string, orgSlug: string): string | null {
  try {
    const parsed = parseBlobRef(ref);
    if (parsed.backend !== 's3' || !s3KeyBelongsToOrg(parsed.key, orgSlug)) {
      return null;
    }
    return parsed.key;
  } catch {
    return null;
  }
}
