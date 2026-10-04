// @vitest-environment node

import type { Sql, TransactionSql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { addJobInTx, deleteUnheldOrgBlobRefs, loadActiveHolds } = vi.hoisted(
  () => ({
    addJobInTx: vi.fn(async () => 'job-1'),
    deleteUnheldOrgBlobRefs: vi.fn(),
    loadActiveHolds: vi.fn(),
  }),
);

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx }));
vi.mock('./service.ts', () => ({ deleteUnheldOrgBlobRefs }));
vi.mock('../legal_holds/service.ts', () => ({ loadActiveHolds }));

import {
  COMPOSER_HANDOFF_MS,
  handoffComposerBlobs,
  queueBlobRetirement,
  queueHolderBlobRetirement,
  recoverBlobRetirements,
  RETIREMENT_BATCH,
  retireBlobBatch,
} from './retirement.ts';

type Statement = { text: string; values: unknown[]; begin: number | null };
type Begin = { status: 'open' | 'committed' | 'rolled_back' };

function fakeSql(answers: Record<string, unknown[]> = {}) {
  const statements: Statement[] = [];
  const begins: Begin[] = [];
  const transactions: unknown[] = [];
  const record = (
    begin: number | null,
    strings: TemplateStringsArray,
    ...values: unknown[]
  ) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values, begin });
    const hit = Object.entries(answers).find(([needle]) =>
      text.includes(needle),
    );
    return Promise.resolve(hit?.[1] ?? []);
  };
  const sql = Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) =>
      record(null, strings, ...values),
    {
      begin: async (callback: (tx: unknown) => unknown) => {
        const index = begins.push({ status: 'open' }) - 1;
        const tx = (strings: TemplateStringsArray, ...values: unknown[]) =>
          record(index, strings, ...values);
        transactions.push(tx);
        try {
          const result = await callback(tx);
          begins[index] = { status: 'committed' };
          return result;
        } catch (error) {
          begins[index] = { status: 'rolled_back' };
          throw error;
        }
      },
    },
  );
  return {
    sql: sql as unknown as Sql & TransactionSql,
    statements,
    begins,
    transactions,
  };
}

const NOW = 1_000_000;
const REF = 's3:blobs/acme/retired';
const DUE = 'SELECT storage_ref AS ref FROM app.blob_reclaims';
const LOCK =
  'SELECT storage_ref, custodian_user_ids, custody_unknown FROM app.blob_reclaims';

beforeEach(() => {
  vi.resetAllMocks();
  vi.spyOn(Date, 'now').mockReturnValue(NOW);
  loadActiveHolds.mockResolvedValue({
    orgHeld: false,
    userMembershipIds: new Set(),
  });
  deleteUnheldOrgBlobRefs.mockImplementation(async (_sql, _org, refs) => refs);
});

afterEach(() => vi.restoreAllMocks());

describe('blob retirement enqueue and composer handoff', () => {
  it('deduplicates and sorts refs, keeps the earliest deadline, and enqueues on the caller transaction', async () => {
    const { sql, statements, begins, transactions } = fakeSql();
    await sql.begin(async (tx) => {
      await queueBlobRetirement(tx, 'o1', ['z', 'a', 'z'], NOW + 500, [
        'u1',
        'u2',
      ]);
    });
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      begin: 0,
      values: ['o1', NOW + 500, NOW, ['u1', 'u2'], false, ['a', 'z']],
    });
    expect(statements[0]?.text).toContain(
      'ON CONFLICT (org_id, storage_ref) DO UPDATE',
    );
    expect(statements[0]?.text).toContain(
      'least(app.blob_reclaims.next_attempt_at_ms, EXCLUDED.next_attempt_at_ms)',
    );
    expect(statements[0]?.text).toContain('next_dispatch_at_ms = 0');
    expect(statements[0]?.text).toContain(
      'custodian_user_ids = ARRAY(SELECT DISTINCT unnest(app.blob_reclaims.custodian_user_ids || EXCLUDED.custodian_user_ids))',
    );
    expect(statements[0]?.text).toContain(
      'custody_unknown = app.blob_reclaims.custody_unknown OR EXCLUDED.custody_unknown',
    );
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      transactions[0],
      'files.retire_blobs',
      { organizationId: 'o1' },
      {
        startAfter: new Date(NOW + 500),
        singletonKey: 'o1',
      },
    );
    expect(begins).toEqual([{ status: 'committed' }]);
  });

  it('does not write a ledger or enqueue for empty refs', async () => {
    const { sql, statements } = fakeSql();
    await queueBlobRetirement(sql, 'o1', []);
    await handoffComposerBlobs(sql, 'o1', 'u1', []);
    expect(statements).toEqual([]);
    expect(addJobInTx).not.toHaveBeenCalled();
  });

  it('bounds undo protection to fifteen minutes and schedules reclamation at exactly its expiry', async () => {
    const { sql, statements, transactions } = fakeSql();
    await sql.begin(async (tx) => {
      await handoffComposerBlobs(tx, 'o1', 'u1', [REF, REF]);
    });
    expect(COMPOSER_HANDOFF_MS).toBe(15 * 60_000);
    const expiry = NOW + 15 * 60_000;
    expect(statements).toHaveLength(2);
    expect(statements[1]).toMatchObject({
      begin: 0,
      values: ['o1', 'u1', expiry, [REF]],
    });
    expect(statements[1]?.text).toContain(
      'ON CONFLICT (org_id, user_id, storage_ref) DO UPDATE SET expires_at_ms = EXCLUDED.expires_at_ms',
    );
    expect(statements[0]).toMatchObject({
      begin: 0,
      values: ['o1', expiry, NOW, ['u1'], false, [REF]],
    });
    expect(addJobInTx).toHaveBeenCalledExactlyOnceWith(
      transactions[0],
      'files.retire_blobs',
      { organizationId: 'o1' },
      {
        startAfter: new Date(expiry),
        singletonKey: 'o1',
      },
    );
  });

  it('preserves per-ref custody instead of contaminating every candidate with the batch owners', async () => {
    const { sql, statements, transactions } = fakeSql();
    await sql.begin(async (tx) => {
      await queueHolderBlobRetirement(tx, 'o1', [
        { refs: ['a', 'shared', 'mixed'], custodianUserIds: ['u1'] },
        { refs: ['b', 'shared'], custodianUserIds: ['u2'] },
        { refs: ['mixed', 'legacy'], custodianUserIds: [] },
        { refs: ['b'], custodianUserIds: ['u2'] },
      ]);
    });
    expect(
      statements.map((statement) => ({
        begin: statement.begin,
        values: statement.values,
      })),
    ).toEqual([
      { begin: 0, values: ['o1', NOW, NOW, ['u1'], false, ['a']] },
      { begin: 0, values: ['o1', NOW, NOW, ['u2'], false, ['b']] },
      { begin: 0, values: ['o1', NOW, NOW, [], true, ['legacy']] },
      { begin: 0, values: ['o1', NOW, NOW, ['u1'], true, ['mixed']] },
      { begin: 0, values: ['o1', NOW, NOW, ['u1', 'u2'], false, ['shared']] },
    ]);
    expect(addJobInTx).toHaveBeenCalledTimes(5);
    for (const call of addJobInTx.mock.calls) {
      expect(call).toEqual([
        transactions[0],
        'files.retire_blobs',
        { organizationId: 'o1' },
        { startAfter: new Date(NOW), singletonKey: 'o1' },
      ]);
    }
  });

  it('records unknown provenance independently even when that ref also has known custodians', async () => {
    const { sql, statements } = fakeSql();
    await queueBlobRetirement(sql, 'o1', [REF], NOW, ['u1'], true);
    await queueBlobRetirement(sql, 'o1', [REF], NOW, ['u2']);
    expect(statements.map((statement) => statement.values)).toEqual([
      ['o1', NOW, NOW, ['u1'], true, [REF]],
      ['o1', NOW, NOW, ['u2'], false, [REF]],
    ]);
    for (const statement of statements) {
      expect(statement.text).toContain(
        'custody_unknown = app.blob_reclaims.custody_unknown OR EXCLUDED.custody_unknown',
      );
    }
  });

  it('does not install a handoff when its durable retirement enqueue fails', async () => {
    const { sql, statements, begins } = fakeSql();
    addJobInTx.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(
      sql.begin(async (tx) => handoffComposerBlobs(tx, 'o1', 'u1', [REF])),
    ).rejects.toThrow('queue unavailable');
    expect(statements).toHaveLength(1);
    expect(statements[0]?.text).toContain('INSERT INTO app.blob_reclaims');
    expect(begins).toEqual([{ status: 'rolled_back' }]);
  });
});

describe('retireBlobBatch', () => {
  it('selects at most 25 due refs in deterministic order and acknowledges only strict successful deletion', async () => {
    const refs = Array.from({ length: 25 }, (_, index) => `${REF}-${index}`);
    const { sql, statements, begins, transactions } = fakeSql({
      [DUE]: refs.map((ref) => ({ ref })),
      [LOCK]: [
        { storage_ref: REF, custodian_user_ids: [], custody_unknown: true },
      ],
    });
    await retireBlobBatch(sql, 'o1');
    expect(RETIREMENT_BATCH).toBe(25);
    expect(statements[0]).toMatchObject({
      begin: null,
      values: ['o1', NOW, 25],
    });
    expect(statements[0]?.text).toContain(
      'WHERE org_id = ? AND next_attempt_at_ms <= ? ORDER BY next_attempt_at_ms, storage_ref LIMIT ?',
    );
    expect(deleteUnheldOrgBlobRefs).toHaveBeenCalledTimes(25);
    expect(begins).toEqual(refs.map(() => ({ status: 'committed' })));
    for (const [index, ref] of refs.entries()) {
      expect(deleteUnheldOrgBlobRefs).toHaveBeenNthCalledWith(
        index + 1,
        transactions[index],
        'o1',
        [ref],
        { strict: true },
      );
      const lane = statements.filter((statement) => statement.begin === index);
      expect(lane[0]?.text).toContain(
        'AND next_attempt_at_ms <= ? FOR UPDATE SKIP LOCKED',
      );
      expect(lane[0]?.values).toEqual(['o1', ref, NOW]);
      expect(lane[1]?.text).toContain('DELETE FROM app.blob_composer_handoffs');
      expect(lane[1]?.values).toEqual(['o1', ref, NOW]);
      expect(lane.at(-1)?.text).toBe(
        'DELETE FROM app.blob_reclaims WHERE org_id = ? AND storage_ref = ?',
      );
      expect(lane.at(-1)?.values).toEqual(['o1', ref]);
    }
  });

  it('retains the durable candidate on storage failure, backs off, and still processes the rest of the batch', async () => {
    const next = `${REF}-next`;
    const { sql, statements, begins } = fakeSql({
      [DUE]: [{ ref: REF }, { ref: next }],
      [LOCK]: [{ storage_ref: REF }],
    });
    deleteUnheldOrgBlobRefs.mockRejectedValueOnce(
      new Error('store refused deletion'),
    );
    await expect(retireBlobBatch(sql, 'o1')).rejects.toThrow(
      'durable candidates retained',
    );
    expect(begins).toEqual([
      { status: 'rolled_back' },
      { status: 'committed' },
    ]);
    const acknowledgements = statements.filter((statement) =>
      statement.text.startsWith('DELETE FROM app.blob_reclaims'),
    );
    expect(acknowledgements).toEqual([
      expect.objectContaining({ values: ['o1', next], begin: 1 }),
    ]);
    expect(
      statements.find((statement) =>
        statement.text.includes("last_outcome = 'failed'"),
      ),
    ).toMatchObject({
      begin: null,
      values: [NOW + 60_000, 'o1', REF],
    });
    expect(deleteUnheldOrgBlobRefs).toHaveBeenCalledTimes(2);
  });

  it.each(['a listed holder', 'a trashed but restorable row'])(
    'retains a candidate protected by %s rather than acknowledging it',
    async () => {
      const { sql, statements, transactions } = fakeSql({
        [DUE]: [{ ref: REF }],
        [LOCK]: [{ storage_ref: REF }],
      });
      deleteUnheldOrgBlobRefs.mockResolvedValue([]);
      await retireBlobBatch(sql, 'o1');
      expect(deleteUnheldOrgBlobRefs).toHaveBeenCalledExactlyOnceWith(
        transactions[0],
        'o1',
        [REF],
        { strict: true },
      );
      expect(
        statements.some((statement) =>
          statement.text.startsWith('DELETE FROM app.blob_reclaims'),
        ),
      ).toBe(false);
      expect(statements.at(-1)).toMatchObject({
        begin: 0,
        values: [NOW + 60_000, 'held', 'o1', REF],
      });
      expect(statements.at(-1)?.text).toContain('attempts = attempts + 1');
    },
  );

  it.each([
    { orgHeld: true, userMembershipIds: new Set<string>() },
    { orgHeld: false, userMembershipIds: new Set(['membership-1']) },
  ])('never asks storage to delete under a legal hold: %j', async (holds) => {
    const { sql, statements, transactions } = fakeSql({
      [DUE]: [{ ref: REF }],
      [LOCK]: [
        { storage_ref: REF, custodian_user_ids: [], custody_unknown: true },
      ],
    });
    loadActiveHolds.mockResolvedValue(holds);
    await retireBlobBatch(sql, 'o1');
    expect(loadActiveHolds).toHaveBeenCalledExactlyOnceWith(
      transactions[0],
      'o1',
    );
    expect(deleteUnheldOrgBlobRefs).not.toHaveBeenCalled();
    expect(
      statements.some((statement) =>
        statement.text.startsWith('DELETE FROM app.blob_reclaims'),
      ),
    ).toBe(false);
    expect(statements.at(-1)).toMatchObject({
      begin: 0,
      values: [NOW + 60_000, 'legal_hold', 'o1', REF],
    });
  });

  it('does nothing when another worker owns or has already consumed the candidate', async () => {
    const { sql, statements, begins } = fakeSql({
      [DUE]: [{ ref: REF }],
      [LOCK]: [],
    });
    await retireBlobBatch(sql, 'o1');
    expect(statements).toHaveLength(2);
    expect(begins).toEqual([{ status: 'committed' }]);
    expect(loadActiveHolds).not.toHaveBeenCalled();
    expect(deleteUnheldOrgBlobRefs).not.toHaveBeenCalled();
  });

  it.each([
    ['known held custodian', ['u1'], false, ['u1'], true],
    ['one held custodian among several', ['u1', 'u2'], false, ['u2'], true],
    ['unrelated custodian hold', ['u1'], false, ['u2'], false],
    ['unknown custody with any membership hold', [], true, ['u2'], true],
    ['unknown custody without holds', [], true, [], false],
    [
      'known and unknown custody with unrelated hold',
      ['u1'],
      true,
      ['u2'],
      true,
    ],
  ] as const)(
    'scopes legal holds for %s',
    async (_name, custodians, custodyUnknown, heldUsers, protectedByHold) => {
      const { sql, statements, transactions } = fakeSql({
        [DUE]: [{ ref: REF }],
        [LOCK]: [
          {
            storage_ref: REF,
            custodian_user_ids: [...custodians],
            custody_unknown: custodyUnknown,
          },
        ],
      });
      loadActiveHolds.mockResolvedValue({
        orgHeld: false,
        userMembershipIds: new Set(heldUsers),
      });
      await retireBlobBatch(sql, 'o1');
      const acknowledged = statements.filter((statement) =>
        statement.text.startsWith('DELETE FROM app.blob_reclaims'),
      );
      if (protectedByHold) {
        expect(deleteUnheldOrgBlobRefs).not.toHaveBeenCalled();
        expect(acknowledged).toEqual([]);
        expect(statements.at(-1)).toMatchObject({
          begin: 0,
          values: [NOW + 60_000, 'legal_hold', 'o1', REF],
        });
      } else {
        expect(deleteUnheldOrgBlobRefs).toHaveBeenCalledExactlyOnceWith(
          transactions[0],
          'o1',
          [REF],
          { strict: true },
        );
        expect(acknowledged).toEqual([
          expect.objectContaining({ begin: 0, values: ['o1', REF] }),
        ]);
      }
    },
  );
});

describe('recoverBlobRetirements', () => {
  it('does not enqueue when no candidate is due', async () => {
    const { sql, statements, begins } = fakeSql();
    await recoverBlobRetirements(sql);
    expect(statements).toHaveLength(1);
    expect(addJobInTx).not.toHaveBeenCalled();
    expect(begins).toEqual([{ status: 'committed' }]);
  });

  it('locks a bounded rotating set and enqueues each organization once in the same transaction', async () => {
    const { sql, statements, begins, transactions } = fakeSql({
      'WITH candidates AS MATERIALIZED': [
        { organizationId: 'o1' },
        { organizationId: 'o1' },
        { organizationId: 'o2' },
      ],
    });
    await recoverBlobRetirements(sql);
    expect(statements).toHaveLength(1);
    expect(statements[0]).toMatchObject({
      begin: 0,
      values: [NOW, NOW, 25, NOW + 60_000],
    });
    expect(statements[0]?.text).toContain(
      'WHERE next_attempt_at_ms <= ? AND next_dispatch_at_ms <= ?',
    );
    expect(statements[0]?.text).toContain(
      'ORDER BY next_dispatch_at_ms, org_id, storage_ref LIMIT ? FOR UPDATE SKIP LOCKED',
    );
    expect(statements[0]?.text).toContain(
      'UPDATE app.blob_reclaims ledger SET next_dispatch_at_ms = ?',
    );
    expect(statements[0]?.text).toContain(
      'ledger.org_id = candidates.org_id AND ledger.storage_ref = candidates.storage_ref',
    );
    expect(addJobInTx).toHaveBeenCalledTimes(2);
    expect(addJobInTx).toHaveBeenNthCalledWith(
      1,
      transactions[0],
      'files.retire_blobs',
      { organizationId: 'o1' },
      { singletonKey: 'o1' },
    );
    expect(addJobInTx).toHaveBeenNthCalledWith(
      2,
      transactions[0],
      'files.retire_blobs',
      { organizationId: 'o2' },
      { singletonKey: 'o2' },
    );
    expect(begins).toEqual([{ status: 'committed' }]);
  });

  it('rolls back the rotation when the queue refuses the job', async () => {
    const { sql, begins } = fakeSql({
      'WITH candidates AS MATERIALIZED': [{ organizationId: 'o1' }],
    });
    addJobInTx.mockRejectedValueOnce(new Error('queue unavailable'));
    await expect(recoverBlobRetirements(sql)).rejects.toThrow(
      'queue unavailable',
    );
    expect(begins).toEqual([{ status: 'rolled_back' }]);
  });
});
