// @vitest-environment node

import type { Sql } from 'postgres';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  type MockInstance,
  vi,
} from 'vitest';

import {
  forgetCorpusWriteRefusals,
  forgetRepairAttempts,
} from '../../core/knowledge/index_health.ts';
import {
  closeKnowledgePools,
  setPoolFactory,
  type PoolFactory,
} from '../../core/knowledge/pool.ts';
import { createBootDatabaseWait } from '../../db/boot-wait.ts';
import { ROUTINE_RESTART_MS } from '../../db/unavailable.ts';
import { reportError } from '../../error-reporting.ts';
import { bootDefaultKnowledge } from './boot.ts';
import type { IndexHealthEffects } from './index-health.ts';

vi.mock('../../error-reporting.ts', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../error-reporting.ts')>()),
  reportError: vi.fn(),
}));

/**
 * The boot's knowledge steps against a knowledge database that restarts as
 * the process boots. The database is a double behind the pool factory, on a
 * clock the boot's wait moves: it refuses every connection until the clock
 * reaches the moment it answers, then answers the schema bootstrap and the
 * index scan as a healthy corpus does.
 */

const URL = 'postgresql://tale:pw@knowledge-db:5432/tale_knowledge';

function withCode(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

/** What a server in its shutdown phase answers a new connection with. */
const shuttingDown = (): Error =>
  withCode('the database system is shutting down', '57P03');

/** What a stopped server's host answers: no mark of postgres.js on it, as
 * on a refused `reserve()`. */
const refused = (): Error =>
  withCode('connect ECONNREFUSED 10.0.0.5:5432', 'ECONNREFUSED');

interface KnowledgeDatabase {
  readonly clock: { now: number };
  /** Connections the schema bootstrap reserved and got. */
  reserved: number;
  /** Indexes the scan verified. */
  verified: number;
  readonly factory: PoolFactory;
}

/** A knowledge database that refuses with `refusal` until the clock reaches
 * `answersFrom`, and with `failure` (when given) once it answers. */
function knowledgeDatabase(options: {
  answersFrom: number;
  refusal: () => Error;
  bootstrapFailure?: Error;
}): KnowledgeDatabase {
  const db: KnowledgeDatabase = {
    clock: { now: 0 },
    reserved: 0,
    verified: 0,
    factory: (_url, poolOptions) =>
      poolOptions?.session === true ? session() : pool(),
  };
  const down = () => db.clock.now < options.answersFrom;

  // The deployment-default pool: the schema bootstrap reserves one
  // connection and runs the migrations on it.
  const pool = (): Sql => {
    const reserved = {
      unsafe: () => Promise.resolve([]),
      release: () => undefined,
    };
    return {
      reserve: () => {
        if (down()) return Promise.reject(options.refusal());
        if (options.bootstrapFailure !== undefined) {
          return Promise.reject(options.bootstrapFailure);
        }
        db.reserved += 1;
        return Promise.resolve(reserved);
      },
      end: () => Promise.resolve(),
    } as unknown as Sql;
  };

  // The scan's own session: the advisory lock, the discovery, the verifier.
  const session = (): Sql =>
    ({
      unsafe: (text: string) => {
        if (down()) return Promise.reject(options.refusal());
        if (text.includes('pg_try_advisory_lock')) {
          return Promise.resolve([{ locked: true }]);
        }
        if (text.includes("amname = 'bm25'")) {
          return Promise.resolve([
            {
              schema: 'private_knowledge',
              name: 'idx_pk_chunks_bm25',
              valid: true,
              bytes: '2932736',
            },
          ]);
        }
        if (text.includes('pdb.verify_index')) {
          db.verified += 1;
          return Promise.resolve([
            { check_name: 'schema_valid', passed: true, details: 'ok' },
          ]);
        }
        return Promise.resolve([]);
      },
      end: () => Promise.resolve(),
    }) as unknown as Sql;

  return db;
}

function bootWait(db: KnowledgeDatabase) {
  return createBootDatabaseWait({
    now: () => db.clock.now,
    sleep: (ms) => {
      db.clock.now += ms;
      return Promise.resolve();
    },
  });
}

interface Spies extends IndexHealthEffects {
  announce: ReturnType<typeof vi.fn<IndexHealthEffects['announce']>>;
  requeueRefused: ReturnType<
    typeof vi.fn<IndexHealthEffects['requeueRefused']>
  >;
}

function effects(): Spies {
  return {
    scheduleRebuild: vi.fn(() => Promise.resolve()),
    announce: vi.fn<IndexHealthEffects['announce']>(() => Promise.resolve()),
    requeueRefused: vi.fn<IndexHealthEffects['requeueRefused']>(() =>
      Promise.resolve(0),
    ),
    failRefused: vi.fn(() => Promise.resolve(0)),
    resumeRefused: vi.fn(() => Promise.resolve(0)),
  };
}

const sql = {} as unknown as Sql;
let previousUrl: string | undefined;
let warn: MockInstance<typeof console.warn>;
let error: MockInstance<typeof console.error>;

/** The warning lines the boot itself wrote, without the wait's retries. */
function bootWarnings(): string[] {
  return warn.mock.calls
    .map((call) => String(call[0]))
    .filter((line) => line.startsWith('[backend]'));
}

beforeEach(() => {
  previousUrl = process.env.KNOWLEDGE_DATABASE_URL;
  process.env.KNOWLEDGE_DATABASE_URL = URL;
  warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  error = vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(async () => {
  await closeKnowledgePools();
  setPoolFactory(null);
  forgetRepairAttempts();
  forgetCorpusWriteRefusals();
  vi.mocked(reportError).mockClear();
  vi.restoreAllMocks();
  if (previousUrl === undefined) delete process.env.KNOWLEDGE_DATABASE_URL;
  else process.env.KNOWLEDGE_DATABASE_URL = previousUrl;
});

describe('the boot of the default knowledge corpus', () => {
  it('waits out a knowledge database that restarts as the process boots, then bootstraps it and verifies its indexes', async () => {
    const db = knowledgeDatabase({
      answersFrom: 20_000,
      refusal: shuttingDown,
    });
    setPoolFactory(db.factory);
    const spies = effects();

    await bootDefaultKnowledge(sql, {
      bootstrapSchema: true,
      wait: bootWait(db),
      effects: spies,
    });

    expect(db.reserved).toBe(1);
    expect(db.verified).toBe(1);
    // A healthy report reaches its effects, once.
    expect(spies.requeueRefused).toHaveBeenCalledTimes(1);
    expect(reportError).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(bootWarnings()).toEqual([]);
  });

  it('reports a knowledge database that stays down once, and says the index verification was skipped', async () => {
    const db = knowledgeDatabase({ answersFrom: Infinity, refusal: refused });
    setPoolFactory(db.factory);
    const spies = effects();

    await bootDefaultKnowledge(sql, {
      bootstrapSchema: true,
      wait: bootWait(db),
      effects: spies,
    });

    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: 'ECONNREFUSED' }),
      { tags: { 'tale.lane': 'boot' } },
    );
    // One minute for the whole outage: the scan, which meets it after the
    // bootstrap gave up, does not wait a second one.
    expect(db.clock.now).toBeGreaterThanOrEqual(ROUTINE_RESTART_MS);
    expect(db.clock.now).toBeLessThan(ROUTINE_RESTART_MS + 10_000);
    expect(db.verified).toBe(0);
    expect(spies.announce).not.toHaveBeenCalled();
    expect(spies.requeueRefused).not.toHaveBeenCalled();
    const warnings = bootWarnings();
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('default corpus bootstrap skipped');
    expect(warnings[1]).toContain(
      'BM25 index verification of the default corpus skipped',
    );
    expect(warnings[1]).toContain('Until this process restarts');
    expect(error).not.toHaveBeenCalled();
  });

  it('reports a knowledge database that stays down once in the api role, which only verifies', async () => {
    const db = knowledgeDatabase({
      answersFrom: Infinity,
      refusal: shuttingDown,
    });
    setPoolFactory(db.factory);

    await bootDefaultKnowledge(sql, {
      bootstrapSchema: false,
      wait: bootWait(db),
      effects: effects(),
    });

    expect(reportError).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ code: '57P03' }),
      { tags: { 'tale.lane': 'boot' } },
    );
    expect(db.reserved).toBe(0);
    const warnings = bootWarnings();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain(
      'BM25 index verification of the default corpus skipped',
    );
  });

  it('reports a bootstrap that fails for another reason at once, and still verifies the indexes', async () => {
    const denied = withCode(
      'permission denied for database tale_knowledge',
      '42501',
    );
    const db = knowledgeDatabase({
      answersFrom: 0,
      refusal: refused,
      bootstrapFailure: denied,
    });
    setPoolFactory(db.factory);

    await bootDefaultKnowledge(sql, {
      bootstrapSchema: true,
      wait: bootWait(db),
      effects: effects(),
    });

    expect(reportError).toHaveBeenCalledExactlyOnceWith(denied, {
      tags: { 'tale.lane': 'boot' },
    });
    expect(warn).toHaveBeenCalledWith(
      '[backend] default corpus bootstrap failed:',
      denied,
    );
    expect(db.clock.now).toBe(0);
    expect(db.verified).toBe(1);
  });

  it('reports a connection string the driver cannot take at once in the api role, which only verifies', async () => {
    const invalid = new Error('sslmode "sometimes" is not one of disable, …');
    const db = knowledgeDatabase({ answersFrom: 0, refusal: refused });
    setPoolFactory(() => {
      throw invalid;
    });

    await bootDefaultKnowledge(sql, {
      bootstrapSchema: false,
      wait: bootWait(db),
      effects: effects(),
    });

    expect(reportError).toHaveBeenCalledExactlyOnceWith(invalid, {
      tags: { 'tale.lane': 'boot' },
    });
    expect(error).toHaveBeenCalledWith(
      '[backend] knowledge index verification failed:',
      invalid,
    );
    expect(db.clock.now).toBe(0);
  });
});
