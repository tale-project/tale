// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { closeKnowledgePools, setPoolFactory } from './core/knowledge/pool';
import { probeStores, resetStoreHealth } from './store-health';

/**
 * The gauge that tells an operator an EXTERNAL store stopped answering. Its
 * whole value is being right about "down", so the cases that matter are the
 * ones where something failed for a reason that is not the store being
 * unreachable.
 */

/**
 * A handle whose `SELECT 1` succeeds or throws. `end` is part of the double
 * because the knowledge pool cache is closed between tests.
 */
function fakeSql(error?: Error): Sql {
  const tag = async (): Promise<unknown[]> => {
    if (error) throw error;
    return [];
  };
  const end = async (): Promise<void> => undefined;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return Object.assign(tag, { end }) as unknown as Sql;
}

/** A knowledge pool whose `SELECT 1` succeeds or throws. */
function stubKnowledgePool(error?: Error): void {
  setPoolFactory(() => fakeSql(error));
}

function stubS3(status: number): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(() => Promise.resolve(new Response('', { status }))),
  );
}

function statusOf(
  statuses: { name: string; up: boolean }[],
  name: string,
): boolean | undefined {
  return statuses.find((s) => s.name === name)?.up;
}

let savedConfigDir: string | undefined;

beforeEach(() => {
  resetStoreHealth();
  savedConfigDir = process.env.TALE_CONFIG_DIR;
  // No config tree ⇒ the object store resolves to "unconfigured", which is a
  // legitimate down. Tests that care about S3 set their own.
  process.env.TALE_CONFIG_DIR = '/nonexistent-tale-config';
  stubKnowledgePool();
  stubS3(200);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  // The pool cache is module state keyed by connection string, so without
  // this every later test would keep reading the FIRST test's stub.
  await closeKnowledgePools();
  setPoolFactory(null);
  resetStoreHealth();
  if (savedConfigDir === undefined) {
    delete process.env.TALE_CONFIG_DIR;
  } else {
    process.env.TALE_CONFIG_DIR = savedConfigDir;
  }
});

describe('probeStores', () => {
  it('reports every store it knows about', async () => {
    const statuses = await probeStores(fakeSql());
    expect(statuses.map((s) => s.name).sort()).toEqual([
      'app_db',
      'knowledge_db',
      'object_store',
    ]);
  });

  it('marks the app database down when it cannot be reached', async () => {
    const statuses = await probeStores(fakeSql(new Error('ECONNREFUSED')));
    expect(statusOf(statuses, 'app_db')).toBe(false);
    expect(statuses.find((s) => s.name === 'app_db')?.detail).toContain(
      'ECONNREFUSED',
    );
  });

  it('marks an unconfigured object store down', async () => {
    // S3 is the only blob backend, so "no connection" is not a neutral state:
    // the deployment refuses every upload.
    const statuses = await probeStores(fakeSql());
    expect(statusOf(statuses, 'object_store')).toBe(false);
  });

  it('does NOT blame the knowledge database for a statement error', async () => {
    // A syntax error or a missing table says nothing about reachability, and
    // paging someone for it would train them to ignore the gauge.
    const notConnectionRelated = Object.assign(new Error('bad column'), {
      code: '42703',
    });
    stubKnowledgePool(notConnectionRelated);
    const statuses = await probeStores(fakeSql());
    expect(statusOf(statuses, 'knowledge_db')).toBe(true);
  });

  it('marks the knowledge database down on a connection-class failure', async () => {
    const refused = Object.assign(new Error('connection refused'), {
      code: 'ECONNREFUSED',
    });
    stubKnowledgePool(refused);
    const statuses = await probeStores(fakeSql());
    expect(statusOf(statuses, 'knowledge_db')).toBe(false);
  });

  it('gives up on a store that never answers', async () => {
    // This runs on the metrics scrape path, and a Postgres pool waits out its
    // own connect_timeout — 30 s for a corpus. Without a bound of its own the
    // gauge would hold the whole /metrics response open.
    const hangs = () => new Promise<never>(() => undefined);
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
    const stalled = Object.assign(hangs, {
      end: async (): Promise<void> => undefined,
    }) as unknown as Sql;
    vi.useFakeTimers();
    try {
      const probe = probeStores(stalled);
      await vi.advanceTimersByTimeAsync(6_000);
      const statuses = await probe;
      expect(statusOf(statuses, 'app_db')).toBe(false);
      expect(statuses.find((s) => s.name === 'app_db')?.detail).toContain(
        'did not answer',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('serves a second call from the cache instead of re-probing', async () => {
    const sql = fakeSql();
    const first = await probeStores(sql);
    const second = await probeStores(sql);
    // A scrape must not cost a round-trip to every store.
    expect(second).toBe(first);
  });
});
