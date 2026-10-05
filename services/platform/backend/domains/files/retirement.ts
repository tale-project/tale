import type { Sql, TransactionSql } from 'postgres';

import { addJobInTx } from '../../jobs/enqueue.ts';
import { loadActiveHolds } from '../legal_holds/service.ts';
import { deleteUnheldOrgBlobRefs } from './service.ts';

export const COMPOSER_HANDOFF_MS = 15 * 60_000;
export const RETIREMENT_BATCH = 25;

export async function queueBlobRetirement(
  tx: Sql | TransactionSql,
  organizationId: string,
  refs: readonly string[],
  dueAt = Date.now(),
  custodianUserIds: readonly string[] = [],
  custodyUnknown = custodianUserIds.length === 0,
): Promise<void> {
  const unique = [...new Set(refs)].sort();
  if (unique.length === 0) return;
  await tx`
    INSERT INTO app.blob_reclaims
      (org_id, storage_ref, next_attempt_at_ms, created_at_ms, custodian_user_ids, custody_unknown)
    SELECT ${organizationId}, ref, ${dueAt}, ${Date.now()}, ${[...custodianUserIds]}::text[], ${custodyUnknown}
    FROM unnest(${unique}::text[]) AS refs(ref)
    ON CONFLICT (org_id, storage_ref) DO UPDATE SET
      next_attempt_at_ms = least(app.blob_reclaims.next_attempt_at_ms, EXCLUDED.next_attempt_at_ms),
      next_dispatch_at_ms = 0,
      custodian_user_ids = ARRAY(SELECT DISTINCT unnest(app.blob_reclaims.custodian_user_ids || EXCLUDED.custodian_user_ids)),
      custody_unknown = app.blob_reclaims.custody_unknown OR EXCLUDED.custody_unknown
  `;
  await addJobInTx(
    tx,
    'files.retire_blobs',
    { organizationId },
    {
      startAfter: new Date(dueAt),
      singletonKey: organizationId,
    },
  );
}

export async function queueHolderBlobRetirement(
  tx: Sql | TransactionSql,
  organizationId: string,
  holders: readonly {
    refs: readonly string[];
    custodianUserIds: readonly string[];
  }[],
): Promise<void> {
  const candidates = new Map<
    string,
    { custodians: Set<string>; unknown: boolean }
  >();
  for (const holder of holders) {
    for (const ref of holder.refs) {
      const candidate = candidates.get(ref) ?? {
        custodians: new Set<string>(),
        unknown: false,
      };
      holder.custodianUserIds.forEach((custodian) =>
        candidate.custodians.add(custodian),
      );
      candidate.unknown ||= holder.custodianUserIds.length === 0;
      candidates.set(ref, candidate);
    }
  }
  for (const ref of [...candidates.keys()].sort()) {
    const candidate = candidates.get(ref);
    if (candidate)
      await queueBlobRetirement(
        tx,
        organizationId,
        [ref],
        Date.now(),
        [...candidate.custodians].sort(),
        candidate.unknown,
      );
  }
}

export async function handoffComposerBlobs(
  tx: TransactionSql,
  organizationId: string,
  userId: string,
  refs: readonly string[],
): Promise<void> {
  if (refs.length === 0) return;
  const expiresAt = Date.now() + COMPOSER_HANDOFF_MS;
  await queueBlobRetirement(tx, organizationId, refs, expiresAt, [userId]);
  await tx`
    INSERT INTO app.blob_composer_handoffs (org_id, user_id, storage_ref, expires_at_ms)
    SELECT ${organizationId}, ${userId}, ref, ${expiresAt}
    FROM unnest(${[...new Set(refs)].sort()}::text[]) AS refs(ref)
    ON CONFLICT (org_id, user_id, storage_ref) DO UPDATE SET expires_at_ms = EXCLUDED.expires_at_ms
  `;
}

export async function retireBlobBatch(
  sql: Sql,
  organizationId: string,
): Promise<void> {
  const due = await sql<{ ref: string }[]>`
    SELECT storage_ref AS ref FROM app.blob_reclaims
    WHERE org_id = ${organizationId} AND next_attempt_at_ms <= ${Date.now()}
    ORDER BY next_attempt_at_ms, storage_ref LIMIT ${RETIREMENT_BATCH}
  `;
  let failed = false;
  for (const candidate of due) {
    try {
      await sql.begin(async (tx) => {
        const locked = await tx<
          {
            storage_ref: string;
            custodian_user_ids: string[];
            custody_unknown: boolean;
          }[]
        >`
          SELECT storage_ref, custodian_user_ids, custody_unknown FROM app.blob_reclaims
          WHERE org_id = ${organizationId} AND storage_ref = ${candidate.ref}
            AND next_attempt_at_ms <= ${Date.now()}
          FOR UPDATE SKIP LOCKED
        `;
        if (locked.length === 0) return;
        await tx`
          DELETE FROM app.blob_composer_handoffs
          WHERE org_id = ${organizationId} AND storage_ref = ${candidate.ref}
            AND expires_at_ms <= ${Date.now()}
        `;
        const holds = await loadActiveHolds(tx, organizationId);
        const custodians = locked[0]?.custodian_user_ids;
        const legallyHeld =
          holds.orgHeld ||
          (Array.isArray(custodians) && custodians.length > 0
            ? custodians.some(
                (custodian: unknown) =>
                  typeof custodian === 'string' &&
                  holds.userMembershipIds.has(custodian),
              )
            : false) ||
          ((locked[0]?.custody_unknown ?? true) &&
            holds.userMembershipIds.size > 0);
        const deleted = legallyHeld
          ? []
          : await deleteUnheldOrgBlobRefs(tx, organizationId, [candidate.ref], {
              strict: true,
            });
        if (deleted.length > 0) {
          await tx`DELETE FROM app.blob_reclaims WHERE org_id = ${organizationId} AND storage_ref = ${candidate.ref}`;
        } else {
          await tx`
            UPDATE app.blob_reclaims SET next_attempt_at_ms = ${Date.now() + 60_000},
              attempts = attempts + 1, last_outcome = ${legallyHeld ? 'legal_hold' : 'held'}
            WHERE org_id = ${organizationId} AND storage_ref = ${candidate.ref}
          `;
        }
      });
    } catch {
      failed = true;
      await sql`
        UPDATE app.blob_reclaims SET next_attempt_at_ms = ${Date.now() + 60_000},
          attempts = attempts + 1, last_outcome = 'failed'
        WHERE org_id = ${organizationId} AND storage_ref = ${candidate.ref}
      `;
    }
  }
  if (failed)
    throw new Error('Blob retirement failed; durable candidates retained');
}

export async function recoverBlobRetirements(sql: Sql): Promise<void> {
  await sql.begin(async (tx) => {
    const due = await tx<{ organizationId: string }[]>`
      WITH candidates AS MATERIALIZED (
        SELECT org_id, storage_ref FROM app.blob_reclaims
        WHERE next_attempt_at_ms <= ${Date.now()} AND next_dispatch_at_ms <= ${Date.now()}
        ORDER BY next_dispatch_at_ms, org_id, storage_ref
        LIMIT ${RETIREMENT_BATCH} FOR UPDATE SKIP LOCKED
      )
      UPDATE app.blob_reclaims ledger SET next_dispatch_at_ms = ${Date.now() + 60_000}
      FROM candidates
      WHERE ledger.org_id = candidates.org_id AND ledger.storage_ref = candidates.storage_ref
      RETURNING ledger.org_id AS "organizationId"
    `;
    for (const organizationId of new Set(
      due.map((row) => row.organizationId),
    )) {
      await addJobInTx(
        tx,
        'files.retire_blobs',
        { organizationId },
        { singletonKey: organizationId },
      );
    }
  });
}
