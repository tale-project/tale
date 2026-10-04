import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import type { RecordCheck } from '../../integration-lane-helpers.ts';
import {
  COMPOSER_HANDOFF_MS,
  handoffComposerBlobs,
  queueBlobRetirement,
} from './retirement.ts';

export async function checkBlobRetirementSchema(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const org = `itest-retirement-${randomUUID()}`;
  const otherOrg = `itest-retirement-${randomUUID()}`;
  const ref = `s3:blobs/itest-retirement/${randomUUID()}`;
  const user = `itest-user-${randomUUID()}`;
  const before = Date.now();
  try {
    await sql.begin(async (tx) => {
      await queueBlobRetirement(
        tx,
        org,
        [ref, ref],
        before + COMPOSER_HANDOFF_MS,
        [user],
      );
      await handoffComposerBlobs(tx, org, user, [ref]);
    });
    const rows = await sql<
      {
        organizationId: string;
        ref: string;
        custodians: string[];
        expiresAt: number;
      }[]
    >`
      SELECT ledger.org_id AS "organizationId", ledger.storage_ref AS ref,
        ledger.custodian_user_ids AS custodians, handoff.expires_at_ms::float8 AS "expiresAt"
      FROM app.blob_reclaims ledger JOIN app.blob_composer_handoffs handoff
        ON handoff.org_id = ledger.org_id AND handoff.storage_ref = ledger.storage_ref
      WHERE ledger.org_id = ${org}
    `;
    record(
      'blob retirement: commit retains one deduplicated, org-scoped bounded owned handoff',
      rows.length === 1 &&
        rows[0]?.organizationId === org &&
        rows[0]?.ref === ref &&
        rows[0]?.custodians.includes(user) &&
        rows[0]?.expiresAt >= before + COMPOSER_HANDOFF_MS &&
        rows[0]?.expiresAt <= Date.now() + COMPOSER_HANDOFF_MS,
      'bounded owned handoff persists with the transition',
    );
    let rolledBack = false;
    try {
      await sql.begin(async (tx) => {
        await queueBlobRetirement(
          tx,
          otherOrg,
          [ref],
          before + COMPOSER_HANDOFF_MS,
        );
        throw new Error('itest rollback');
      });
    } catch (error) {
      rolledBack = error instanceof Error && error.message === 'itest rollback';
    }
    const absent =
      await sql`SELECT storage_ref FROM app.blob_reclaims WHERE org_id = ${otherOrg}`;
    record(
      'blob retirement: a rolled-back transition leaves no reclaim candidate',
      rolledBack && absent.length === 0,
      'rollback leaves no ledger row',
    );
    await sql`SELECT attachment_ownership FROM app.messages WHERE false`;
    await sql`SELECT attachment_owner_user_id FROM app.conversation_messages WHERE false`;
    record(
      'blob retirement: trusted chat and mail ownership columns are available after boot migrations',
      true,
      'both nullable columns are readable',
    );
  } finally {
    await sql`DELETE FROM app.blob_composer_handoffs WHERE org_id = ANY(${[org, otherOrg]}::text[])`;
    await sql`DELETE FROM app.blob_reclaims WHERE org_id = ANY(${[org, otherOrg]}::text[])`;
  }
}
