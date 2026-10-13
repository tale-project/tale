import { randomUUID } from 'node:crypto';

import type { Sql } from 'postgres';

import {
  createAuditLog,
  sealAuditChainNow,
} from './domains/audit_logs/service.ts';
import { verifyAuditChain } from './domains/audit_logs/verify.ts';
import {
  AUDIT_WRITE_ORDER,
  type RecordCheck,
} from './integration-lane-helpers.ts';

/** Real writer/reader proof with ties at insertion, never a global clock mock
 * or an update of retained audit rows. The trigger acts only on this probe's
 * organization and transaction-local settings; other writers are untouched. */
export async function checkAuditEventOrder(
  sql: Sql,
  record: RecordCheck,
): Promise<void> {
  const organizationId = `itest-audit-order-${randomUUID()}`;
  const trigger = `itest_audit_order_${randomUUID().replaceAll('-', '')}`;
  const writer = await sql.reserve();
  const timestamp = Date.now();
  let ordinal = 0;
  try {
    await writer`
      CREATE FUNCTION pg_temp.itest_audit_order_stamp() RETURNS trigger
      LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.org_id = current_setting('tale.itest_audit_order_org', true) THEN
          NEW.ts := current_setting('tale.itest_audit_order_ts')::bigint;
          NEW.id := current_setting('tale.itest_audit_order_id');
        END IF;
        RETURN NEW;
      END;
      $$
    `;
    await writer`
      CREATE TRIGGER ${writer(trigger)} BEFORE INSERT ON app.audit_logs
      FOR EACH ROW EXECUTE FUNCTION pg_temp.itest_audit_order_stamp()
    `;
    const write = async (
      action: string,
      resourceType: string,
      metadata?: Record<string, unknown>,
    ) => {
      ordinal += 1;
      await sql.begin(async (tx) => {
        await tx`
          SELECT set_config('tale.itest_audit_order_org', ${organizationId}, true),
                 set_config('tale.itest_audit_order_ts', ${String(timestamp)}, true),
                 set_config('tale.itest_audit_order_id', ${`${organizationId}-${100 - ordinal}`}, true)
        `;
        await createAuditLog(tx, {
          organizationId,
          actorId: 'itest-audit-order',
          actorType: 'system',
          action,
          category: resourceType === 'twoFactorAuth' ? 'security' : 'data',
          resourceType,
          resourceId: resourceType,
          status: 'success',
          ...(metadata === undefined ? {} : { metadata }),
        });
      });
    };
    const passkeys = ['passkey_added', 'passkey_sign_in', 'passkey_removed'];
    for (const action of passkeys) await write(action, 'twoFactorAuth');
    await write('retention.run_started', 'retention_run');
    await write('usage_ledger.retention_deleted', 'retention_run', {
      deleted: 4,
    });
    await write('sandbox_ledger.retention_deleted', 'retention_run', {
      deleted: 2,
    });
    await write('retention.run_completed', 'retention_run', { deleted: 6 });

    const rows = await writer<
      {
        action: string;
        category: string;
        status: string;
        resourceType: string;
        metadata: { deleted?: number } | null;
        timestamp: string;
        writerXid: string;
      }[]
    >`
      SELECT action, category, status, resource_type AS "resourceType", metadata,
             ts::text AS timestamp, writer_xid::text AS "writerXid"
      FROM app.audit_logs WHERE org_id = ${organizationId}
      ORDER BY ${writer.unsafe(AUDIT_WRITE_ORDER)}
    `;
    const tied = new Set(rows.map((row) => row.timestamp)).size === 1;
    const separateWrites = new Set(rows.map((row) => row.writerXid)).size === 7;
    const security = rows.filter((row) => row.resourceType === 'twoFactorAuth');
    record(
      'audit oracles: tied security events retain each committed lifecycle write',
      tied &&
        separateWrites &&
        security.length === 3 &&
        security.map((row) => row.action).join(',') === passkeys.join(',') &&
        security.every(
          (row) => row.category === 'security' && row.status === 'success',
        ),
      `tied=${tied}, transactions=${separateWrites}, actions=${security.map((row) => row.action).join(',')}`,
    );
    const retention = rows.filter(
      (row) => row.resourceType === 'retention_run',
    );
    record(
      'audit oracles: tied retention writes retain start, category counts and closing total',
      tied &&
        separateWrites &&
        retention.length === 4 &&
        retention.map((row) => row.action).join(',') ===
          'retention.run_started,usage_ledger.retention_deleted,sandbox_ledger.retention_deleted,retention.run_completed' &&
        retention[1]?.metadata?.deleted === 4 &&
        retention[2]?.metadata?.deleted === 2 &&
        retention[3]?.metadata?.deleted === 6 &&
        retention.every(
          (row) => row.category === 'data' && row.status === 'success',
        ),
      `actions=${retention.map((row) => row.action).join(',')}, closing=${retention.at(-1)?.metadata?.deleted}`,
    );
    await sealAuditChainNow(sql, organizationId);
    const chain = await verifyAuditChain(sql, organizationId);
    record(
      'audit oracles: tied fixture rows still form the complete valid sealed chain',
      chain.valid &&
        chain.verifiedCount === 7 &&
        chain.awaitingSeal.count === 0 &&
        !chain.truncated,
      `valid=${chain.valid}, rows=${chain.verifiedCount}, unsealed=${chain.awaitingSeal.count}`,
    );
  } finally {
    // Only this probe's new rows, never another organization's audit state.
    await writer`DROP TRIGGER IF EXISTS ${writer(trigger)} ON app.audit_logs`;
    await writer`DELETE FROM app.audit_logs WHERE org_id = ${organizationId}`;
    await writer`DELETE FROM app.audit_chain_heads WHERE org_id = ${organizationId}`;
    await writer`DROP FUNCTION IF EXISTS pg_temp.itest_audit_order_stamp()`;
    writer.release();
  }
}
