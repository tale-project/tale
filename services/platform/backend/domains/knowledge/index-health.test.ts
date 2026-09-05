// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  assertCorpusWritable,
  forgetCorpusWriteRefusals,
  refuseCorpusWrites,
  setCorpusWritesResumedHook,
  WRITE_GUARD_RECHECK_MS,
  type Bm25Index,
  type IndexHealthReport,
  type IndexReport,
} from '../../core/knowledge/index_health.ts';
import { setCorpusBootstrapHook } from '../../core/knowledge/pool.ts';
import {
  applyIndexHealthReport,
  installCorpusHealthHook,
  runReindexBm25Job,
  type IndexHealthEffects,
} from './index-health.ts';

/**
 * What the product DOES about each verification outcome: the write guard,
 * the background job, the announcement. The effects are spies — the real ones
 * (pg-boss, the audit chain, the bell) run in the integration harness.
 */

const URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';
const PK: Bm25Index = {
  schema: 'private_knowledge',
  name: 'idx_pk_chunks_bm25',
  sizeBytes: 2_932_736,
  valid: true,
};
const PW: Bm25Index = {
  schema: 'public_web',
  name: 'idx_pw_chunks_bm25',
  sizeBytes: 2_883_584,
  valid: true,
};
const CHECKS = [{ check: 'schema_valid', passed: true, details: 'ok' }];

function report(...indexes: IndexReport[]): IndexHealthReport {
  return { status: 'done', startedAt: 1_700_000_000_000, indexes };
}

interface Spies extends IndexHealthEffects {
  scheduleRebuild: ReturnType<
    typeof vi.fn<IndexHealthEffects['scheduleRebuild']>
  >;
  announce: ReturnType<typeof vi.fn<IndexHealthEffects['announce']>>;
  requeueRefused: ReturnType<
    typeof vi.fn<IndexHealthEffects['requeueRefused']>
  >;
  failRefused: ReturnType<typeof vi.fn<IndexHealthEffects['failRefused']>>;
  resumeRefused: ReturnType<typeof vi.fn<IndexHealthEffects['resumeRefused']>>;
}

function spies(): Spies {
  return {
    scheduleRebuild: vi.fn<IndexHealthEffects['scheduleRebuild']>(() =>
      Promise.resolve(),
    ),
    announce: vi.fn<IndexHealthEffects['announce']>(() => Promise.resolve()),
    requeueRefused: vi.fn<IndexHealthEffects['requeueRefused']>(() =>
      Promise.resolve(2),
    ),
    failRefused: vi.fn<IndexHealthEffects['failRefused']>(() =>
      Promise.resolve(2),
    ),
    resumeRefused: vi.fn<IndexHealthEffects['resumeRefused']>(() =>
      Promise.resolve(2),
    ),
  };
}

const sql = {} as unknown as Sql;
let previousUrl: string | undefined;

beforeEach(() => {
  previousUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.KNOWLEDGE_DATABASE_URL = URL;
});

afterEach(() => {
  forgetCorpusWriteRefusals();
  setCorpusWritesResumedHook(null);
  setCorpusBootstrapHook(null);
  if (previousUrl === undefined) delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousUrl;
});

describe('acting on a verification report', () => {
  it('schedules a deferred rebuild, refuses writes meanwhile, and announces it', async () => {
    const effects = spies();

    await applyIndexHealthReport(
      report(
        {
          index: PW,
          outcome: { kind: 'healthy', checks: CHECKS },
          verifyMs: 3,
        },
        {
          index: PK,
          outcome: { kind: 'deferred', reason: 'assertion failed' },
          verifyMs: 5,
        },
      ),
      { kind: 'default' },
      URL,
      effects,
    );

    expect(effects.scheduleRebuild).toHaveBeenCalledTimes(1);
    expect(effects.scheduleRebuild).toHaveBeenCalledWith(
      { kind: 'default' },
      PK,
    );
    expect(effects.announce).toHaveBeenCalledTimes(1);
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'rebuild_scheduled',
      index: PK,
      reason: 'assertion failed',
    });
    expect(effects.announce.mock.calls[0]?.[3]).toBe(1_700_000_000_000);
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'rebuilding' });
    // The healthy corpus of the same database stays open.
    await expect(
      assertCorpusWritable(URL, PW.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
  });

  it('announces an inline repair and leaves writes open', async () => {
    const effects = spies();

    await applyIndexHealthReport(
      report({
        index: PK,
        outcome: {
          kind: 'repaired',
          reason: 'assertion failed',
          path: 'inline',
          reindexMs: 812,
          checks: CHECKS,
        },
        verifyMs: 5,
      }),
      { kind: 'org', orgSlug: 'acme' },
      URL,
      effects,
    );

    expect(effects.scheduleRebuild).not.toHaveBeenCalled();
    expect(effects.announce).toHaveBeenCalledTimes(1);
    expect(effects.announce.mock.calls[0]?.[0]).toEqual({
      kind: 'org',
      orgSlug: 'acme',
    });
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repaired',
      path: 'inline',
      reindexMs: 812,
    });
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
  });

  it('a failed repair refuses writes and announces the failure', async () => {
    const effects = spies();

    await applyIndexHealthReport(
      report({
        index: PK,
        outcome: {
          kind: 'repair_failed',
          reason: 'assertion failed',
          path: 'inline',
          reindexMs: 900,
          error: 'still failing after REINDEX',
        },
        verifyMs: 5,
      }),
      { kind: 'default' },
      URL,
      effects,
    );

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'repair_failed' });
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repair_failed',
      error: 'still failing after REINDEX',
    });
    expect(effects.scheduleRebuild).not.toHaveBeenCalled();
  });

  it('an index this process already rebuilt once is refused, never rebuilt again', async () => {
    const effects = spies();

    await applyIndexHealthReport(
      report({
        index: PK,
        outcome: { kind: 'not_retried', reason: 'assertion failed' },
        verifyMs: 5,
      }),
      { kind: 'default' },
      URL,
      effects,
    );

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'repair_failed' });
    expect(effects.scheduleRebuild).not.toHaveBeenCalled();
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repair_failed',
      path: null,
    });
  });

  it('healthy, unverifiable, and invalid outcomes have no effects', async () => {
    const effects = spies();

    await applyIndexHealthReport(
      report(
        {
          index: PK,
          outcome: { kind: 'healthy', checks: CHECKS },
          verifyMs: 1,
        },
        {
          index: PW,
          outcome: { kind: 'unverifiable', reason: 'no verifier' },
          verifyMs: 1,
        },
        {
          index: { ...PW, valid: false },
          outcome: { kind: 'invalid' },
          verifyMs: 0,
        },
      ),
      { kind: 'default' },
      URL,
      effects,
    );

    expect(effects.scheduleRebuild).not.toHaveBeenCalled();
    expect(effects.announce).not.toHaveBeenCalled();
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
    await expect(
      assertCorpusWritable(URL, PW.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
  });
});

describe('the background rebuild job', () => {
  const payload = { orgSlug: null, schema: PK.schema, name: PK.name };

  it('a verified rebuild lifts the refusal, announces, and re-queues refused files', async () => {
    const effects = spies();
    await applyIndexHealthReport(
      report({
        index: PK,
        outcome: { kind: 'deferred', reason: 'assertion failed' },
        verifyMs: 5,
      }),
      { kind: 'default' },
      URL,
      effects,
    );
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'rebuilding' });
    effects.announce.mockClear();

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: PK,
        outcome: {
          kind: 'repaired',
          reason: 'assertion failed',
          path: 'background',
          reindexMs: 61_000,
          checks: CHECKS,
        },
        verifyMs: 40,
      }),
    );

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
    expect(effects.announce).toHaveBeenCalledTimes(1);
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repaired',
      path: 'background',
    });
    expect(effects.requeueRefused).toHaveBeenCalledWith(
      { kind: 'default' },
      URL,
    );
  });

  it('a failed rebuild hardens the refusal and announces it', async () => {
    const effects = spies();

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: PK,
        outcome: {
          kind: 'repair_failed',
          reason: 'assertion failed',
          path: 'background',
          reindexMs: 61_000,
          error: 'REINDEX failed: could not read block 357',
        },
        verifyMs: 40,
      }),
    );

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'repair_failed' });
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repair_failed',
      error: 'REINDEX failed: could not read block 357',
    });
    expect(effects.requeueRefused).not.toHaveBeenCalled();
    // The files parked as "resumes automatically" are told the truth.
    expect(effects.failRefused).toHaveBeenCalledWith(
      { kind: 'default' },
      URL,
      PK,
    );
  });

  it('an index that no longer exists lifts the refusal and re-queues the files it parked', async () => {
    const effects = spies();
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK });

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: { ...PK, sizeBytes: 0 },
        outcome: { kind: 'missing' },
        verifyMs: 0,
      }),
    );

    // Used to lift the refusal and return: writes flowed again while every
    // parked row kept its "resumes automatically" note, forever.
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
    expect(effects.requeueRefused).toHaveBeenCalledWith(
      { kind: 'default' },
      URL,
    );
    expect(effects.announce).not.toHaveBeenCalled();
  });

  it('an index marked invalid is a failed repair: refused, announced, parked files re-stamped', async () => {
    const effects = spies();
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK });

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: { ...PK, valid: false },
        outcome: { kind: 'invalid' },
        verifyMs: 0,
      }),
    );

    // Nothing rebuilds an invalid index on its own — the job used to return
    // with the "rebuilding" refusal in place and no follow-up scheduled.
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'repair_failed' });
    // No rebuild ran: the audit row must not claim a 0 ms background one.
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repair_failed',
      path: null,
      reindexMs: 0,
      error: expect.stringContaining('DROP INDEX CONCURRENTLY'),
    });
    expect(effects.failRefused).toHaveBeenCalledTimes(1);
    expect(effects.requeueRefused).not.toHaveBeenCalled();
  });

  it('a rebuild that could not verify is tried again later, refusal kept', async () => {
    const effects = spies();
    refuseCorpusWrites(URL, PK.schema, { state: 'rebuilding', index: PK });

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: PK,
        outcome: { kind: 'unverifiable', reason: 'pdb.verify_index missing' },
        verifyMs: 3,
      }),
    );

    // Unknown is not healthy: the refusal stays, and the rebuild is queued
    // again with a delay instead of dropped with the files still parked.
    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).rejects.toMatchObject({ state: 'rebuilding' });
    expect(effects.scheduleRebuild).toHaveBeenCalledWith(
      { kind: 'default' },
      PK,
      { delayMs: 5 * 60_000 },
    );
    expect(effects.requeueRefused).not.toHaveBeenCalled();
    expect(effects.failRefused).not.toHaveBeenCalled();
    expect(effects.announce).not.toHaveBeenCalled();
  });

  it('an index rebuilt elsewhere lifts the refusal and re-queues without an announcement', async () => {
    const effects = spies();
    await applyIndexHealthReport(
      report({
        index: PK,
        outcome: { kind: 'deferred', reason: 'assertion failed' },
        verifyMs: 5,
      }),
      { kind: 'default' },
      URL,
      effects,
    );
    effects.announce.mockClear();

    await runReindexBm25Job(sql, payload, effects, () =>
      Promise.resolve({
        index: PK,
        outcome: { kind: 'healthy', checks: CHECKS },
        verifyMs: 40,
      }),
    );

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
    expect(effects.announce).not.toHaveBeenCalled();
    expect(effects.requeueRefused).toHaveBeenCalledTimes(1);
  });
});

describe('the write guard lifting a refusal itself', () => {
  const HEALTHY_ROWS = [
    { check_name: 'schema_valid', passed: true, details: 'ok' },
    { check_name: 'index_readable', passed: true, details: 'ok' },
    { check_name: 'checksums_valid', passed: true, details: 'ok' },
  ];

  it('re-queues the files parked on that database', async () => {
    // A write re-verified the index healthy — rebuilt in another process, or
    // repaired by an operator's REINDEX — outside any rebuild job. Writes
    // resumed; the parked files did not, with a note saying they would.
    const effects = spies();
    installCorpusHealthHook(sql, effects);
    refuseCorpusWrites(
      URL,
      PK.schema,
      { state: 'repair_failed', index: PK },
      0,
    );
    const session = {
      unsafe: (text: string) =>
        text.includes('pdb.verify_index')
          ? Promise.resolve(HEALTHY_ROWS)
          : Promise.reject(new Error(`unexpected statement: ${text}`)),
      end: () => Promise.resolve(),
    } as unknown as Sql;

    await assertCorpusWritable(URL, PK.schema, {
      openSession: () => session,
      now: () => WRITE_GUARD_RECHECK_MS + 1,
    });

    await expect(
      assertCorpusWritable(URL, PK.schema, { now: () => 0 }),
    ).resolves.toBeUndefined();
    expect(effects.resumeRefused).toHaveBeenCalledWith(URL);
  });
});
