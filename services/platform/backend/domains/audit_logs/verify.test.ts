import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { computeAuditHash } from '../../core/lib/helpers/audit_hash.ts';
import { writeNotificationForOrgs } from '../notifications/service.ts';
import { auditLogRetentionCutoff } from '../retention/service.ts';
import { rowToHashInput } from './hash-input.ts';
import type { AuditLogRow } from './types.ts';
import { runScheduledIntegrityCheck, verifyAuditChain } from './verify.ts';

vi.mock('../notifications/service.ts', () => ({
  writeNotificationForOrgs: vi.fn(),
}));
vi.mock('../retention/service.ts', () => ({
  auditLogRetentionCutoff: vi.fn(),
}));

/** Whatever a statement answers with — audit rows, a progress row, nothing. */
type Row = object;

/**
 * A postgres.js tagged-template stand-in: the test answers each statement
 * from its (whitespace-collapsed) text; `begin` hands the same tag back as
 * the transaction. Only the shapes the verify walk touches are modelled.
 */
function fakeDb(answer: (text: string, values: unknown[]) => Row[]): {
  db: Sql;
  statements: { text: string; values: unknown[] }[];
} {
  const statements: { text: string; values: unknown[] }[] = [];
  const tag = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<Row[]> => {
    const text = strings.join('?').replaceAll(/\s+/g, ' ').trim();
    statements.push({ text, values });
    return Promise.resolve(answer(text, values));
  };
  const db = Object.assign(tag, {
    unsafe: (text: string) => text,
    begin: (callback: (tx: unknown) => Promise<unknown>) => callback(db),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a three-member stand-in for the postgres.js template function
  return { db: db as unknown as Sql, statements };
}

const ORG = 'org-1';

/** A genuine chain of `count` rows, one second apart, hash-linked. */
async function buildChain(
  count: number,
  startTs: number,
): Promise<AuditLogRow[]> {
  const rows: AuditLogRow[] = [];
  let previous = '';
  for (let index = 0; index < count; index += 1) {
    const row: AuditLogRow = {
      id: `row-${index + 1}`,
      organizationId: ORG,
      actorId: 'user-1',
      actorEmail: null,
      actorEmailHash: null,
      actorRole: null,
      actorType: 'user',
      action: `action.${index + 1}`,
      category: 'data',
      resourceType: 'probe',
      resourceId: null,
      resourceName: null,
      previousState: null,
      newState: null,
      changedFields: null,
      sessionId: null,
      ipAddress: null,
      actorIpHash: null,
      userAgent: null,
      requestId: null,
      timestamp: startTs + index * 1000,
      status: 'success',
      errorMessage: null,
      metadata: null,
      integrityHash: '',
      previousHash: previous === '' ? null : previous,
      piiScrubbed: null,
    };
    row.integrityHash = await computeAuditHash(previous, rowToHashInput(row));
    previous = row.integrityHash;
    rows.push(row);
  }
  return rows;
}

const isRowPage = (text: string): boolean =>
  text.startsWith('SELECT ? FROM app.audit_logs');

describe('verifyAuditChain — a resume anchor the retention sweep reaped', () => {
  const START = 1_700_000_000_000;

  it('resumes after an anchor that is still there', async () => {
    const chain = await buildChain(5, START);
    const [, r2, r3, r4, r5] = chain;
    if (!r2 || !r3 || !r4 || !r5) throw new Error('chain');
    const { db } = fakeDb((text) => (isRowPage(text) ? [r2, r3, r4, r5] : []));
    const result = await verifyAuditChain(db, ORG, {
      fromTimestamp: r2.timestamp,
      afterId: r2.id,
      previousExpectedHash: r2.integrityHash,
      reapedBefore: START - 1,
    });
    expect(result.valid).toBe(true);
    expect(result.verifiedCount).toBe(3);
    expect(result.lastVerifiedId).toBe(r5.id);
    expect(result.reanchored).toBeUndefined();
  });

  it('re-anchors when the anchor (and its successor) were reaped past the cutoff', async () => {
    const chain = await buildChain(5, START);
    const [, r2, r3, r4, r5] = chain;
    if (!r2 || !r3 || !r4 || !r5) throw new Error('chain');
    // The sweep took row-2 and row-3: the first survivor links to the reaped
    // row-3, not to the resume hash (row-2). Retention, not tampering.
    const { db } = fakeDb((text) => (isRowPage(text) ? [r4, r5] : []));
    const result = await verifyAuditChain(db, ORG, {
      fromTimestamp: r2.timestamp,
      afterId: r2.id,
      previousExpectedHash: r2.integrityHash,
      reapedBefore: r3.timestamp + 1,
    });
    expect(result.valid).toBe(true);
    expect(result.reanchored).toBe(true);
    expect(result.verifiedCount).toBe(2);
    expect(result.lastVerifiedId).toBe(r5.id);
    expect(result.lastVerifiedHash).toBe(r5.integrityHash);
  });

  it('still reports a break when the anchor vanished INSIDE the retention window', async () => {
    const chain = await buildChain(5, START);
    const [, r2, r3, r4, r5] = chain;
    if (!r2 || !r3 || !r4 || !r5) throw new Error('chain');
    const { db } = fakeDb((text) => (isRowPage(text) ? [r4, r5] : []));
    const result = await verifyAuditChain(db, ORG, {
      fromTimestamp: r2.timestamp,
      afterId: r2.id,
      previousExpectedHash: r2.integrityHash,
      // The cutoff is OLDER than the anchor: nothing legitimately deleted it.
      reapedBefore: r2.timestamp - 1,
    });
    expect(result.valid).toBe(false);
    expect(result.reanchored).toBeUndefined();
    expect(result.firstBrokenAt).toMatchObject({
      logId: r4.id,
      expected: r2.integrityHash,
      actual: r3.integrityHash,
    });
  });

  it('never excuses a missing anchor when the org has no audit retention', async () => {
    const chain = await buildChain(5, START);
    const [, r2, , r4, r5] = chain;
    if (!r2 || !r4 || !r5) throw new Error('chain');
    const { db } = fakeDb((text) => (isRowPage(text) ? [r4, r5] : []));
    const result = await verifyAuditChain(db, ORG, {
      fromTimestamp: r2.timestamp,
      afterId: r2.id,
      previousExpectedHash: r2.integrityHash,
    });
    expect(result.valid).toBe(false);
    expect(result.firstBrokenAt?.logId).toBe(r4.id);
  });
});

describe('runScheduledIntegrityCheck — the tamper bell survives a failed write', () => {
  beforeEach(() => {
    vi.mocked(writeNotificationForOrgs).mockReset();
    vi.mocked(auditLogRetentionCutoff).mockReset();
    vi.mocked(auditLogRetentionCutoff).mockResolvedValue(null);
  });

  async function brokenOrg(): Promise<{
    rows: AuditLogRow[];
    anchor: AuditLogRow;
    fingerprint: string;
  }> {
    const chain = await buildChain(3, 1_700_000_000_000);
    const [r1, r2, r3] = chain;
    if (!r1 || !r2 || !r3) throw new Error('chain');
    // row-2 tampered after the fact: its stored hash no longer recomputes.
    const tampered: AuditLogRow = { ...r2, action: 'action.tampered' };
    return {
      rows: [r1, tampered, r3],
      anchor: r1,
      fingerprint: `${tampered.id}:${tampered.integrityHash}`,
    };
  }

  function progressDb(
    rows: AuditLogRow[],
    anchor: AuditLogRow,
    stampedFingerprint: string | null,
  ) {
    return fakeDb((text) => {
      if (isRowPage(text)) return rows;
      if (text.startsWith('SELECT last_verified_ts')) {
        return [
          {
            lastVerifiedTs: anchor.timestamp,
            lastVerifiedId: anchor.id,
            lastVerifiedHash: anchor.integrityHash,
            lastAlertedFingerprint: stampedFingerprint,
          },
        ];
      }
      return [];
    });
  }

  it('stamps the break even when the bell write fails, and reports the miss', async () => {
    const { rows, anchor, fingerprint } = await brokenOrg();
    vi.mocked(writeNotificationForOrgs).mockRejectedValueOnce(
      new Error('bell down'),
    );
    const { db, statements } = progressDb(rows, anchor, null);
    const run = await runScheduledIntegrityCheck(db, ORG);
    expect(run.broken).toBe(true);
    expect(run.alerted).toBe(false);
    const stamp = statements.find((statement) =>
      statement.text.startsWith('INSERT INTO app.audit_integrity_progress'),
    );
    expect(stamp?.values).toContain(fingerprint);
    expect(writeNotificationForOrgs).toHaveBeenCalledTimes(1);
  });

  it('re-asserts the bell on the next run instead of trusting the stamp', async () => {
    const { rows, anchor, fingerprint } = await brokenOrg();
    // The previous run stamped the fingerprint but its bell never landed.
    vi.mocked(writeNotificationForOrgs).mockResolvedValue(undefined);
    const { db } = progressDb(rows, anchor, fingerprint);
    const run = await runScheduledIntegrityCheck(db, ORG);
    expect(run.broken).toBe(true);
    expect(run.alerted).toBe(true);
    expect(writeNotificationForOrgs).toHaveBeenCalledTimes(1);
    expect(
      vi.mocked(writeNotificationForOrgs).mock.calls[0]?.[1],
    ).toMatchObject({
      organizationIds: [ORG],
      severity: 'critical',
      titleKey: 'auditIntegrityFailed',
      dedupeKey: `audit-integrity:${fingerprint}`,
    });
  });

  it('asks retention for the cutoff only when there is an anchor to excuse', async () => {
    const { rows, anchor } = await brokenOrg();
    vi.mocked(writeNotificationForOrgs).mockResolvedValue(undefined);
    await runScheduledIntegrityCheck(progressDb(rows, anchor, null).db, ORG);
    expect(auditLogRetentionCutoff).toHaveBeenCalledWith(
      expect.anything(),
      ORG,
    );
    vi.mocked(auditLogRetentionCutoff).mockClear();
    const fresh = fakeDb((text) => (isRowPage(text) ? rows.slice(0, 1) : []));
    await runScheduledIntegrityCheck(fresh.db, ORG);
    expect(auditLogRetentionCutoff).not.toHaveBeenCalled();
  });
});
