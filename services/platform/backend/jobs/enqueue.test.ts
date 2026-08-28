import type { PgBoss } from 'pg-boss';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { addJobInTx, setEnqueueBoss } from './enqueue.ts';

interface CapturedSend {
  name: string;
  data: object | null | undefined;
  options: Record<string, unknown> & {
    db?: { executeSql: (text: string, values?: unknown[]) => Promise<unknown> };
  };
}

function installFakeBoss(): CapturedSend[] {
  const calls: CapturedSend[] = [];
  const fake = {
    send: (
      name: string,
      data: object | null | undefined,
      options: CapturedSend['options'],
    ) => {
      calls.push({ name, data, options });
      return Promise.resolve('job-id');
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; addJobInTx only calls send()
  setEnqueueBoss(fake as unknown as PgBoss);
  return calls;
}

function createFakeTx(): {
  tx: TransactionSql;
  unsafeCalls: { text: string; values: unknown[] }[];
} {
  const unsafeCalls: { text: string; values: unknown[] }[] = [];
  const stub = {
    unsafe: (text: string, values: unknown[] = []) => {
      unsafeCalls.push({ text, values });
      return Promise.resolve([{ id: 'row' }]);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- fake stub for an unconstructable third-party branded type
  return { tx: stub as unknown as TransactionSql, unsafeCalls };
}

describe('addJobInTx', () => {
  it('sends through pg-boss with a tx-bound db adapter', async () => {
    const calls = installFakeBoss();
    const { tx, unsafeCalls } = createFakeTx();
    await addJobInTx(tx, 'noop', { seq: 1 });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call?.name).toBe('noop');
    expect(call?.data).toEqual({ seq: 1 });

    // The db adapter must route pg-boss's SQL through the caller's tx.
    const db = call?.options.db;
    expect(db).toBeDefined();
    await db?.executeSql('INSERT INTO pgboss.job …', ['a', 1]);
    expect(unsafeCalls).toHaveLength(1);
    expect(unsafeCalls[0]?.text).toContain('pgboss.job');
    expect(unsafeCalls[0]?.values).toEqual(['a', 1]);
  });

  it('omits unset options and passes set ones through', async () => {
    const calls = installFakeBoss();
    const { tx } = createFakeTx();
    await addJobInTx(tx, 'noop', {});
    expect(calls[0]?.options.startAfter).toBeUndefined();
    expect(calls[0]?.options.singletonKey).toBeUndefined();
    expect(calls[0]?.options.priority).toBeUndefined();

    const startAfter = new Date('2026-08-28T00:00:00Z');
    await addJobInTx(
      tx,
      'org.scaffold',
      { orgSlug: 'acme' },
      { startAfter, singletonKey: 'org-scaffold:acme', priority: 10 },
    );
    const second = calls[1];
    expect(second?.name).toBe('org.scaffold');
    expect(second?.options.startAfter).toBe(startAfter);
    expect(second?.options.singletonKey).toBe('org-scaffold:acme');
    expect(second?.options.priority).toBe(10);
  });
});
