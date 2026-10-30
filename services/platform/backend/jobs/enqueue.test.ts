import type { PgBoss } from 'pg-boss';
import type { TransactionSql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { addJobInTx, addJobsInTx, setEnqueueBoss } from './enqueue.ts';
import { TASK_QUEUE_OPTIONS } from './tasks.ts';

type CapturedOptions = Record<string, unknown> & {
  db?: { executeSql: (text: string, values?: unknown[]) => Promise<unknown> };
};

interface CapturedSend {
  name: string;
  data: object | null | undefined;
  options: CapturedOptions;
}

interface CapturedInsert {
  name: string;
  jobs: (Record<string, unknown> & { data?: object })[];
  options: CapturedOptions;
}

function installFakeBoss(): CapturedSend[] {
  return installCapturingBoss().sends;
}

function installCapturingBoss(): {
  sends: CapturedSend[];
  inserts: CapturedInsert[];
} {
  const sends: CapturedSend[] = [];
  const inserts: CapturedInsert[] = [];
  const fake = {
    send: (
      name: string,
      data: object | null | undefined,
      options: CapturedOptions,
    ) => {
      sends.push({ name, data, options });
      return Promise.resolve('job-id');
    },
    insert: (
      name: string,
      jobs: CapturedInsert['jobs'],
      options: CapturedOptions,
    ) => {
      inserts.push({ name, jobs, options });
      return Promise.resolve(null);
    },
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- capture stub; the façade only calls send() and insert()
  setEnqueueBoss(fake as unknown as PgBoss);
  return { sends, inserts };
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
  it('sends new automation work only to its protocol queue, with the original payload and policy', async () => {
    const calls = installFakeBoss();
    const { tx } = createFakeTx();
    const payload = { organizationId: 'org-1', runId: 'run-1' };
    await addJobInTx(tx, 'automation.step', payload, {
      singletonKey: 'run-1',
      priority: 7,
    });
    expect(calls[0]?.name).toBe('automation.v2.step');
    expect(calls[0]?.data).toBe(payload);
    expect(calls[0]?.options).toMatchObject({
      singletonKey: 'run-1',
      priority: 7,
      group: { id: 'org-1' },
      heartbeatSeconds: TASK_QUEUE_OPTIONS['automation.step'].heartbeatSeconds,
    });
  });

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

  // `createQueue` inserts a queue and never updates one, so a heartbeat
  // declared after a deployment created the queue would never reach its
  // jobs: it rides every job instead.
  it("sends a queue's heartbeat with each of its jobs, and none elsewhere", async () => {
    const calls = installFakeBoss();
    const { tx } = createFakeTx();
    await addJobInTx(tx, 'websites.scan', {
      domain: 'example.com',
      orgSlug: 'acme',
      organizationId: 'org-1',
    });
    await addJobInTx(tx, 'noop', {});
    expect(calls[0]?.options.heartbeatSeconds).toBe(
      TASK_QUEUE_OPTIONS['websites.scan'].heartbeatSeconds,
    );
    expect(calls[0]?.options.heartbeatSeconds).toBeGreaterThanOrEqual(10);
    expect(calls[1]?.options).not.toHaveProperty('heartbeatSeconds');
  });

  // A queue limited per organization counts each job against the group it
  // was sent with: derived here from the payload, so no enqueue site can
  // leave it out.
  it("stamps a grouped queue's jobs with their group, and no other queue's", async () => {
    const calls = installFakeBoss();
    const { tx } = createFakeTx();
    await addJobInTx(tx, 'automation.step', {
      organizationId: 'org-1',
      runId: 'run-1',
    });
    await addJobInTx(tx, 'automation.poll', {
      organizationId: 'org-1',
      runId: 'run-1',
      seq: 1,
      pollMs: 1000,
    });
    await addJobInTx(
      tx,
      'automation.step',
      { organizationId: 'org-1', runId: 'run-1' },
      { group: 'org-2' },
    );
    expect(calls[0]?.options.group).toEqual({ id: 'org-1' });
    expect(calls[1]?.options).not.toHaveProperty('group');
    // A caller's own group wins over the derived one.
    expect(calls[2]?.options.group).toEqual({ id: 'org-2' });
  });
});

describe('addJobsInTx', () => {
  it('queues every job of one queue in one insert, through a tx-bound db adapter', async () => {
    const { sends, inserts } = installCapturingBoss();
    const { tx, unsafeCalls } = createFakeTx();
    const startAfter = new Date('2026-10-30T06:00:00Z');
    await addJobsInTx(tx, 'notification.email', [
      { payload: { notificationId: 'n-1', epoch: 1 }, options: { startAfter } },
      { payload: { notificationId: 'n-2', epoch: 3 }, options: { startAfter } },
    ]);

    expect(sends).toEqual([]);
    expect(inserts).toHaveLength(1);
    expect(inserts[0]?.name).toBe('notification.email');
    expect(inserts[0]?.jobs).toEqual([
      { data: { notificationId: 'n-1', epoch: 1 }, startAfter },
      { data: { notificationId: 'n-2', epoch: 3 }, startAfter },
    ]);
    // The jobs commit or roll back with the caller's own writes.
    await inserts[0]?.options.db?.executeSql('INSERT INTO pgboss.job …', ['x']);
    expect(unsafeCalls).toEqual([
      { text: 'INSERT INTO pgboss.job …', values: ['x'] },
    ]);
  });

  // pg-boss's `insert` builds each row with the SQL `send` runs, so a job
  // queued in a batch carries what the same job sent alone would.
  it('gives each job the options addJobInTx sends it with', async () => {
    const { sends, inserts } = installCapturingBoss();
    const { tx } = createFakeTx();
    const payload = { organizationId: 'org-1', runId: 'run-1' };
    const options = {
      startAfter: new Date('2026-10-30T06:00:00Z'),
      singletonKey: 'run-1',
      priority: 7,
    };
    await addJobInTx(tx, 'automation.step', payload, options);
    await addJobsInTx(tx, 'automation.step', [{ payload, options }]);

    const { db: _db, ...sent } = sends[0]?.options ?? {};
    expect(inserts[0]?.name).toBe(sends[0]?.name);
    expect(inserts[0]?.name).toBe('automation.v2.step');
    expect(inserts[0]?.jobs).toEqual([{ data: payload, ...sent }]);
    expect(sent).toMatchObject({
      group: { id: 'org-1' },
      heartbeatSeconds: TASK_QUEUE_OPTIONS['automation.step'].heartbeatSeconds,
    });
  });

  it('queues nothing, and asks pg-boss nothing, for no jobs', async () => {
    const { inserts } = installCapturingBoss();
    const { tx } = createFakeTx();
    await addJobsInTx(tx, 'notification.email', []);
    expect(inserts).toEqual([]);
  });
});
