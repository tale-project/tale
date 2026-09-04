// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it } from 'vitest';

import {
  allowCorpusWrites,
  assertCorpusWritable,
  corpusWriteRefusal,
  DEFAULT_INLINE_REPAIR_MAX_BYTES,
  forgetCorpusWriteRefusals,
  forgetRepairAttempts,
  healBm25Indexes,
  humanBytes,
  indexUnavailableMessage,
  inlineRepairMaxBytes,
  KnowledgeIndexUnavailable,
  rebuildBm25IndexInBackground,
  refuseCorpusWrites,
  repairDisabled,
  WRITE_GUARD_RECHECK_MS,
} from './index_health';
import {
  RAG_ERROR_INDEX_REBUILDING,
  RAG_ERROR_INDEX_REPAIR_FAILED,
} from './rag_error_codes';

/**
 * The thing under test is a decision: which index gets rebuilt, when, how
 * often, and what happens to writes in the meantime. PostgreSQL is a recording
 * double — the statements it receives ARE the assertions — scripted with the
 * exact shapes the real server produced on a corrupted index (the verifier
 * RAISES `assertion left == right failed` rather than reporting a failed
 * check) and on a healthy one (four passed checks).
 */

const URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';
const PK = {
  schema: 'private_knowledge',
  name: 'idx_pk_chunks_bm25',
  bytes: 2_932_736,
};
const PW = {
  schema: 'public_web',
  name: 'idx_pw_chunks_bm25',
  bytes: 2_883_584,
};

interface VerifyRow {
  check_name: string;
  passed: boolean;
  details: string | null;
}

const HEALTHY: VerifyRow[] = [
  { check_name: 'schema_valid', passed: true, details: 'Index schema loaded' },
  { check_name: 'index_readable', passed: true, details: 'Reader opened' },
  {
    check_name: 'checksums_valid',
    passed: true,
    details: 'All checksums valid',
  },
  { check_name: 'segment_metadata_valid', passed: true, details: '1 segment' },
];
const FAILED_CHECK: VerifyRow[] = [
  HEALTHY[0]!,
  {
    check_name: 'checksums_valid',
    passed: false,
    details: 'segment 3 checksum mismatch',
  },
];

function pgError(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}
const corrupted = (): Error =>
  pgError(
    'assertion `left == right` failed\n  left: 816\n right: 936',
    'XX000',
  );
const noVerifier = (): Error =>
  pgError('function pdb.verify_index(regclass) does not exist', '42883');

interface Script {
  locked?: boolean;
  lockError?: Error;
  indexes?: Array<{
    schema: string;
    name: string;
    bytes: number;
    valid?: boolean;
  }>;
  /** Verifier answers, one per call in order; the last one repeats. */
  verify?: Array<VerifyRow[] | Error>;
  /** Thrown by REINDEX. */
  reindex?: Error;
}

interface FakeSession {
  statements: string[];
  verifyCalls: string[];
  ended: boolean;
  opened: number;
  openSession: () => Sql;
}

function fakeSession(script: Script = {}): FakeSession {
  const state: FakeSession = {
    statements: [],
    verifyCalls: [],
    ended: false,
    opened: 0,
    openSession: () => sql,
  };
  let verifyCall = 0;
  const unsafe = (text: string, params: unknown[] = []): Promise<unknown[]> => {
    const statement = text.trim();
    state.statements.push(statement);
    if (statement.includes('pg_try_advisory_lock')) {
      if (script.lockError) return Promise.reject(script.lockError);
      return Promise.resolve([{ locked: script.locked ?? true }]);
    }
    if (statement.includes('pg_advisory_lock(')) {
      if (script.lockError) return Promise.reject(script.lockError);
      return Promise.resolve([]);
    }
    if (statement.includes('pg_advisory_unlock')) return Promise.resolve([]);
    if (statement.includes("amname = 'bm25'")) {
      return Promise.resolve(
        (script.indexes ?? []).map((index) => ({
          schema: index.schema,
          name: index.name,
          valid: index.valid ?? true,
          bytes: String(index.bytes),
        })),
      );
    }
    if (statement.includes('pdb.verify_index')) {
      state.verifyCalls.push(`${String(params[0])}.${String(params[1])}`);
      const plan = script.verify ?? [HEALTHY];
      const answer = plan[Math.min(verifyCall, plan.length - 1)]!;
      verifyCall += 1;
      return answer instanceof Error
        ? Promise.reject(answer)
        : Promise.resolve(answer);
    }
    if (statement.startsWith('REINDEX')) {
      return script.reindex
        ? Promise.reject(script.reindex)
        : Promise.resolve([]);
    }
    if (statement.startsWith('DROP INDEX')) return Promise.resolve([]);
    return Promise.reject(new Error(`unexpected statement: ${statement}`));
  };
  const sql = {
    unsafe,
    end: () => {
      state.ended = true;
      return Promise.resolve();
    },
  } as unknown as Sql;
  state.openSession = () => {
    state.opened += 1;
    return sql;
  };
  return state;
}

function reindexStatements(session: FakeSession): string[] {
  return session.statements.filter((statement) =>
    statement.startsWith('REINDEX'),
  );
}

afterEach(() => {
  forgetRepairAttempts();
  forgetCorpusWriteRefusals();
});

describe('verifying the indexes at boot', () => {
  it('discovers every BM25 index by access method and leaves healthy ones alone', async () => {
    const db = fakeSession({ indexes: [PK, PW] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    expect(report.status).toBe('done');
    expect(report.indexes.map((entry) => entry.outcome.kind)).toEqual([
      'healthy',
      'healthy',
    ]);
    expect(db.verifyCalls).toEqual([
      'private_knowledge.idx_pk_chunks_bm25',
      'public_web.idx_pw_chunks_bm25',
    ]);
    // Discovery is by access method — no index name is hard-coded anywhere.
    const discovery = db.statements.find((statement) =>
      statement.includes("amname = 'bm25'"),
    );
    expect(discovery).toBeDefined();
    expect(discovery).not.toContain('idx_pk');
    expect(reindexStatements(db)).toEqual([]);
    // The lock is taken and released on the one session, which is closed.
    expect(db.statements.some((s) => s.includes('pg_try_advisory_lock'))).toBe(
      true,
    );
    expect(db.statements.some((s) => s.includes('pg_advisory_unlock'))).toBe(
      true,
    );
    expect(db.ended).toBe(true);
  });

  it('rebuilds a small corrupted index inline and verifies it again', async () => {
    // The real shape: the verifier RAISES on the corrupted index, then
    // reports four passed checks once it is rebuilt.
    const db = fakeSession({ indexes: [PK], verify: [corrupted(), HEALTHY] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    const [entry] = report.indexes;
    expect(entry?.outcome.kind).toBe('repaired');
    if (entry?.outcome.kind !== 'repaired') return;
    expect(entry.outcome.path).toBe('inline');
    expect(entry.outcome.reason).toContain('assertion');
    expect(entry.outcome.checks).toHaveLength(4);
    expect(reindexStatements(db)).toEqual([
      'REINDEX INDEX "private_knowledge"."idx_pk_chunks_bm25"',
    ]);
    expect(db.verifyCalls).toHaveLength(2);
  });

  it('treats a failed check exactly like a raised error', async () => {
    const db = fakeSession({ indexes: [PK], verify: [FAILED_CHECK, HEALTHY] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    const [entry] = report.indexes;
    expect(entry?.outcome.kind).toBe('repaired');
    if (entry?.outcome.kind !== 'repaired') return;
    expect(entry.outcome.reason).toBe(
      'checksums_valid: segment 3 checksum mismatch',
    );
    expect(reindexStatements(db)).toHaveLength(1);
  });

  it('stops after ONE attempt when the rebuild does not restore health', async () => {
    const first = fakeSession({
      indexes: [PK],
      verify: [corrupted(), corrupted()],
    });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: first.openSession,
    });

    const [entry] = report.indexes;
    expect(entry?.outcome.kind).toBe('repair_failed');
    if (entry?.outcome.kind !== 'repair_failed') return;
    expect(entry.outcome.error).toContain('assertion');
    expect(reindexStatements(first)).toHaveLength(1);

    // The same process looks again (a later bootstrap, a re-check): still
    // unhealthy, and it must NOT rebuild a second time.
    const second = fakeSession({ indexes: [PK], verify: [corrupted()] });
    const again = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: second.openSession,
    });
    expect(again.indexes[0]?.outcome.kind).toBe('not_retried');
    expect(reindexStatements(second)).toEqual([]);
  });

  it('defers a corrupted index above the inline limit instead of blocking', async () => {
    const db = fakeSession({ indexes: [PK], verify: [corrupted()] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
      inlineMaxBytes: 1_000_000,
    });

    const [entry] = report.indexes;
    expect(entry?.outcome.kind).toBe('deferred');
    if (entry?.outcome.kind !== 'deferred') return;
    expect(entry.outcome.reason).toContain('assertion');
    expect(reindexStatements(db)).toEqual([]);
    expect(entry.index.sizeBytes).toBe(PK.bytes);
  });

  it('never rebuilds an index it cannot verify', async () => {
    // An older pg_search without `pdb.verify_index` is unknown, not broken —
    // rebuilding healthy indexes on every boot would be our own outage.
    const db = fakeSession({ indexes: [PK], verify: [noVerifier()] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    expect(report.indexes[0]?.outcome.kind).toBe('unverifiable');
    expect(reindexStatements(db)).toEqual([]);
  });

  it('skips quietly when another process holds the repair lock', async () => {
    const db = fakeSession({ indexes: [PK], locked: false });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    expect(report.status).toBe('locked');
    expect(report.indexes).toEqual([]);
    expect(db.statements.some((s) => s.includes("amname = 'bm25'"))).toBe(
      false,
    );
    expect(db.verifyCalls).toEqual([]);
    expect(db.ended).toBe(true);
  });

  it('skips an invalid leftover copy without verifying it', async () => {
    const leftover = {
      ...PK,
      name: 'idx_pk_chunks_bm25_ccnew',
      valid: false,
    };
    const db = fakeSession({ indexes: [leftover, PK] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    expect(report.indexes.map((entry) => entry.outcome.kind)).toEqual([
      'invalid',
      'healthy',
    ]);
    expect(db.verifyCalls).toEqual(['private_knowledge.idx_pk_chunks_bm25']);
  });

  it('does nothing when the operator switched it off', async () => {
    const db = fakeSession({ indexes: [PK], verify: [corrupted()] });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
      disabled: true,
    });

    expect(report.status).toBe('disabled');
    expect(db.opened).toBe(0);
  });

  it('reports instead of throwing when the database cannot be reached', async () => {
    const db = fakeSession({
      lockError: pgError('connect ECONNREFUSED', 'ECONNREFUSED'),
    });

    const report = await healBm25Indexes({
      url: URL,
      label: 'the test database',
      openSession: db.openSession,
    });

    expect(report.status).toBe('error');
    expect(report.error).toContain('ECONNREFUSED');
    expect(db.ended).toBe(true);
  });
});

describe('the write guard', () => {
  it('refuses writes into a corpus whose index is rebuilding, with the rag error code', async () => {
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK });

    let refusal: unknown;
    try {
      await assertCorpusWritable(URL, PK.schema);
    } catch (error) {
      refusal = error;
    }
    expect(refusal).toBeInstanceOf(KnowledgeIndexUnavailable);
    if (!(refusal instanceof KnowledgeIndexUnavailable)) return;
    expect(refusal.code).toBe(RAG_ERROR_INDEX_REBUILDING);
    expect(refusal.index).toBe('private_knowledge.idx_pk_chunks_bm25');
    expect(refusal.message).toContain('being rebuilt');
    expect(refusal.message).toContain('resumes automatically');

    // The other corpus of the same database, and other databases, stay open.
    await expect(assertCorpusWritable(URL, PW.schema)).resolves.toBeUndefined();
    await expect(
      assertCorpusWritable('postgresql://elsewhere', PK.schema),
    ).resolves.toBeUndefined();
  });

  it('a failed repair refuses with its own code and names the operator move', async () => {
    refuseCorpusWrites(URL, PK.schema, { state: 'repair_failed', index: PK });

    await expect(assertCorpusWritable(URL, PK.schema)).rejects.toMatchObject({
      code: RAG_ERROR_INDEX_REPAIR_FAILED,
    });
    expect(
      indexUnavailableMessage('repair_failed', 'private_knowledge.idx'),
    ).toContain('REINDEX INDEX private_knowledge.idx');
  });

  it('lifts the refusal once the index verifies healthy again', async () => {
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK }, 0);
    const db = fakeSession({ verify: [HEALTHY] });

    await expect(
      assertCorpusWritable(URL, PK.schema, {
        openSession: db.openSession,
        now: () => WRITE_GUARD_RECHECK_MS + 1,
      }),
    ).resolves.toBeUndefined();

    expect(db.verifyCalls).toEqual(['private_knowledge.idx_pk_chunks_bm25']);
    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
    expect(db.ended).toBe(true);
  });

  it('keeps refusing while the re-check fails, and re-checks once per window', async () => {
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK }, 0);
    const db = fakeSession({ verify: [corrupted()] });
    const now = WRITE_GUARD_RECHECK_MS + 1;

    await expect(
      assertCorpusWritable(URL, PK.schema, {
        openSession: db.openSession,
        now: () => now,
      }),
    ).rejects.toBeInstanceOf(KnowledgeIndexUnavailable);
    expect(db.opened).toBe(1);
    expect(corpusWriteRefusal(URL, PK.schema)?.recheckAt).toBe(
      now + WRITE_GUARD_RECHECK_MS,
    );

    // Inside the window: refused outright, no second verification.
    await expect(
      assertCorpusWritable(URL, PK.schema, {
        openSession: db.openSession,
        now: () => now + 1,
      }),
    ).rejects.toBeInstanceOf(KnowledgeIndexUnavailable);
    expect(db.opened).toBe(1);
  });

  it('allowing writes clears the refusal', async () => {
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK });
    allowCorpusWrites(URL, PK.schema);
    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
    await expect(assertCorpusWritable(URL, PK.schema)).resolves.toBeUndefined();
  });
});

describe('the background rebuild', () => {
  it('rebuilds concurrently after waiting for the lock, then verifies', async () => {
    const db = fakeSession({ indexes: [PK], verify: [corrupted(), HEALTHY] });

    const result = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: db.openSession,
    });

    expect(result.outcome.kind).toBe('repaired');
    if (result.outcome.kind !== 'repaired') return;
    expect(result.outcome.path).toBe('background');
    expect(reindexStatements(db)).toEqual([
      'REINDEX INDEX CONCURRENTLY "private_knowledge"."idx_pk_chunks_bm25"',
    ]);
    // A job waits for a sibling's inline repair rather than skipping it.
    expect(db.statements.some((s) => s.includes('pg_advisory_lock('))).toBe(
      true,
    );
    expect(db.ended).toBe(true);
  });

  it('drops the invalid copy a failed concurrent rebuild leaves behind', async () => {
    const db = fakeSession({
      indexes: [PK],
      verify: [corrupted()],
      reindex: pgError('could not read block 357', 'XX001'),
    });

    const result = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: db.openSession,
    });

    expect(result.outcome.kind).toBe('repair_failed');
    expect(db.statements).toContain(
      'DROP INDEX CONCURRENTLY IF EXISTS "private_knowledge"."idx_pk_chunks_bm25_ccnew"',
    );
  });

  it('reports an index already rebuilt elsewhere without touching it', async () => {
    const db = fakeSession({ indexes: [PK], verify: [HEALTHY] });

    const result = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: db.openSession,
    });

    expect(result.outcome.kind).toBe('healthy');
    expect(reindexStatements(db)).toEqual([]);
  });

  it('reports an index that no longer exists', async () => {
    const db = fakeSession({ indexes: [] });

    const result = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: db.openSession,
    });

    expect(result.outcome.kind).toBe('missing');
  });

  it('never rebuilds the same index twice in one process', async () => {
    const first = fakeSession({
      indexes: [PK],
      verify: [corrupted(), corrupted()],
    });
    const attempt = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: first.openSession,
    });
    expect(attempt.outcome.kind).toBe('repair_failed');

    const second = fakeSession({ indexes: [PK], verify: [corrupted()] });
    const again = await rebuildBm25IndexInBackground({
      url: URL,
      label: 'the test database',
      index: PK,
      openSession: second.openSession,
    });
    expect(again.outcome.kind).toBe('not_retried');
    expect(reindexStatements(second)).toEqual([]);
  });
});

describe('configuration', () => {
  it('reads the inline limit from the environment, falling back on nonsense', () => {
    expect(inlineRepairMaxBytes({})).toBe(DEFAULT_INLINE_REPAIR_MAX_BYTES);
    expect(
      inlineRepairMaxBytes({ KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES: '5000' }),
    ).toBe(5000);
    expect(
      inlineRepairMaxBytes({ KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES: '0' }),
    ).toBe(0);
    expect(
      inlineRepairMaxBytes({ KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES: 'lots' }),
    ).toBe(DEFAULT_INLINE_REPAIR_MAX_BYTES);
    expect(
      inlineRepairMaxBytes({ KNOWLEDGE_INDEX_REPAIR_INLINE_MAX_BYTES: '-1' }),
    ).toBe(DEFAULT_INLINE_REPAIR_MAX_BYTES);
  });

  it('recognises the kill switch', () => {
    expect(repairDisabled({})).toBe(false);
    expect(repairDisabled({ KNOWLEDGE_INDEX_REPAIR_DISABLED: '' })).toBe(false);
    expect(repairDisabled({ KNOWLEDGE_INDEX_REPAIR_DISABLED: '1' })).toBe(true);
    expect(repairDisabled({ KNOWLEDGE_INDEX_REPAIR_DISABLED: 'true' })).toBe(
      true,
    );
  });

  it('prints sizes the way an operator reads them', () => {
    expect(humanBytes(500)).toBe('500 B');
    expect(humanBytes(2_932_736)).toBe('2.9 MB');
    expect(humanBytes(1024 ** 3)).toBe('1.1 GB');
  });
});
