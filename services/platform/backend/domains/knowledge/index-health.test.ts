// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  corpusWriteRefusal,
  forgetCorpusWriteRefusals,
  type Bm25Index,
  type IndexHealthReport,
  type IndexReport,
} from '../../core/knowledge/index_health.ts';
import {
  applyIndexHealthReport,
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
    expect(corpusWriteRefusal(URL, PK.schema)?.state).toBe('rebuilding');
    // The healthy corpus of the same database stays open.
    expect(corpusWriteRefusal(URL, PW.schema)).toBeNull();
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
    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
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

    expect(corpusWriteRefusal(URL, PK.schema)?.state).toBe('repair_failed');
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

    expect(corpusWriteRefusal(URL, PK.schema)?.state).toBe('repair_failed');
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
    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
    expect(corpusWriteRefusal(URL, PW.schema)).toBeNull();
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
    expect(corpusWriteRefusal(URL, PK.schema)?.state).toBe('rebuilding');
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

    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
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

    expect(corpusWriteRefusal(URL, PK.schema)?.state).toBe('repair_failed');
    expect(effects.announce.mock.calls[0]?.[2]).toMatchObject({
      kind: 'repair_failed',
      error: 'REINDEX failed: could not read block 357',
    });
    expect(effects.requeueRefused).not.toHaveBeenCalled();
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

    expect(corpusWriteRefusal(URL, PK.schema)).toBeNull();
    expect(effects.announce).not.toHaveBeenCalled();
    expect(effects.requeueRefused).toHaveBeenCalledTimes(1);
  });
});
