// The warm pool, against the real node: standbys that start ahead of time and
// wait, a claim that hands one out as a session (relabelled and given its
// workspace by one write, the token by a file), the refill behind it, the
// capacity it never exceeds, a standby that disappeared, and a rollout: a
// draining spawner stops keeping the pool, and its replacement takes the
// standbys over instead of making new ones.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  lab,
  pause,
  readyStandbys,
  reportFor,
  sessionId,
  sessionInstance,
  sessionVolume,
  sh,
  spawnerOf,
  standbys,
  step,
  until,
} from '../harness.ts';
import { field, type SpawnerApi } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';
import { asText } from '../util.ts';

const report = reportFor('pool');
const token = newToken();
const POOL_SIZE = 2;
const MAX_SESSIONS = 4;
const env = {
  SANDBOX_INCUS_POOL_SIZE: String(POOL_SIZE),
  SANDBOX_MAX_SESSIONS: String(MAX_SESSIONS),
};
const spawner = spawnerOf({ name: 'pool-a', port: 18006, token, env });
const peer = spawnerOf({ name: 'pool-b', port: 18007, token, env });
const api = spawner.api;
const ORG = 'e2e-pool';

/** `warm=<ready>/<target>` of the health detail. The spawner caches its health
 * for a minute, so this lags the node; it is read only where the point is that
 * a spawner reports its pool. */
async function warm(
  from: SpawnerApi,
): Promise<{ ready: number; target: number }> {
  const reply = await from.health();
  const detail = asText(field(reply.json, 'dockerServerVersion'));
  const match = /warm=(\d+)\/(\d+)/.exec(detail);
  if (match === null)
    throw new Error(`no warm count in ${JSON.stringify(reply.text)}`);
  return { ready: Number(match[1]), target: Number(match[2]) };
}

async function occupied(): Promise<number> {
  return (await admin.instances()).filter(
    (instance) =>
      instance.status === 'Running' || instance.status === 'Starting',
  ).length;
}

/** Wait until exactly `count` standbys wait on the node; the time it took. */
async function waitForPool(count: number, what: string): Promise<number> {
  const started = performance.now();
  await until(what, async () => (await readyStandbys()).length === count, {
    timeoutMs: 5 * 60_000,
    intervalMs: 1_000,
  });
  return performance.now() - started;
}

describe('the warm pool on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await peer.stop();
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('the pool fills to its size with standbys that wait', async () => {
    const fill = await waitForPool(POOL_SIZE, 'two standbys ready');
    report.add(`fill the pool (${POOL_SIZE} standbys, from boot)`, fill);
    const waiting = await standbys();
    expect(waiting).toHaveLength(POOL_SIZE);
    for (const standby of waiting) {
      expect(standby.name).toStartWith('tale-sbx-pool-');
      expect(standby.status).toBe('Running');
      expect(standby.devices.workspace).toBeUndefined();
      expect(label(standby.config, LABEL.session)).toBeUndefined();
      expect(standby.config['oci.entrypoint']).toBe(
        '/usr/bin/setpriv --no-new-privs -- /bin/bash /usr/local/lib/tale/standby.sh',
      );
      // The script is root-owned and waiting: its ready marker exists.
      const ready = await admin.exec(
        standby.name,
        ['test', '-f', '/run/tale-standby/ready'],
        { allowFailure: true },
      );
      expect({ name: standby.name, ready: ready.code }).toEqual({
        name: standby.name,
        ready: 0,
      });
      const script = await admin.exec(standby.name, [
        'stat',
        '-c',
        '%U:%a',
        '/usr/local/lib/tale/standby.sh',
      ]);
      expect(script.stdout.trim()).toBe('root:755');
    }
    expect(new Set(waiting.map((s) => label(s.config, LABEL.pool))).size).toBe(
      1,
    );
  });

  step(
    'a create is a claim: relabelled, mounted, started in a moment',
    async () => {
      const before = new Set((await standbys()).map((s) => s.name));
      const id = sessionId('claim');
      const result = await api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(result.reply, 201, 'create from the pool');
      report.add('create from the warm pool (a claim)', result.elapsedMs);

      const instance = await sessionInstance(id);
      if (instance === undefined)
        throw new Error('no instance for the claimed session');
      // A claimed standby keeps the name it was made with.
      expect(before.has(instance.name)).toBe(true);
      expect(label(instance.config, LABEL.session)).toBe(id);
      expect(label(instance.config, LABEL.created)).toBe(
        String(result.session?.createdAtMs),
      );
      expect(instance.devices.workspace?.source).toBeDefined();
      // The runnerd token came by file, not by instance config.
      expect(
        Object.keys(instance.config).filter((key) =>
          key.includes('RUNNERD_TOKEN'),
        ),
      ).toEqual([]);
      expect(JSON.stringify(instance.config)).not.toContain(
        'TALE_RUNNERD_TOKEN',
      );
      // The claim file is gone and the session is a normal one.
      const claim = await admin.exec(
        instance.name,
        ['test', '-e', '/run/tale-standby/claim.env'],
        { allowFailure: true },
      );
      expect(claim.code).not.toBe(0);
      expect((await sh(api, id, 'id -u; stat -c %u /agent')).trim()).toBe(
        '10001\n10001',
      );
      expect(
        await sh(api, id, 'echo claimed > /agent/proof && cat /agent/proof'),
      ).toBe('claimed\n');
      expect(await sessionVolume(id)).toBeDefined();

      // The pool refills behind the claim.
      const refill = await waitForPool(POOL_SIZE, 'the pool to refill');
      report.add('refill the pool after a claim', refill);
      expectStatus(await api.destroy(id), 200, 'destroy the claimed session');
    },
  );

  step('a cold create of the same shape, for comparison', async () => {
    // A render session is never served from the pool.
    const id = sessionId('cold');
    const result = await api.create({
      sessionId: id,
      organizationId: ORG,
      profile: 'default',
      workload: 'workflow',
    });
    expectStatus(result.reply, 201, 'cold create');
    report.add(
      'cold create next to a full pool (render profile)',
      result.elapsedMs,
    );
    expect((await sessionInstance(id))?.name).toStartWith('tale-sbx-ses-');
    expectStatus(await api.destroy(id), 200, 'destroy the cold session');
  });

  step('standbys and sessions never pass the capacity', async () => {
    const ids = [
      sessionId('cap'),
      sessionId('cap'),
      sessionId('cap'),
      sessionId('cap'),
    ];
    for (const id of ids.slice(0, MAX_SESSIONS)) {
      const result = await api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(result.reply, 201, `create ${id}`);
      expect(await occupied()).toBeLessThanOrEqual(MAX_SESSIONS);
    }
    // Four sessions fill the project: no standby is left, none is made.
    await pause(15_000);
    expect(await occupied()).toBe(MAX_SESSIONS);
    expect(await standbys()).toHaveLength(0);
    // The fifth is refused for room, with its place in the line.
    const refused = await api.create({
      sessionId: sessionId('over'),
      organizationId: ORG,
      profile: 'agent',
    });
    expectStatus(refused.reply, 429, 'create past the capacity');
    expect(field(refused.reply.json, 'error')).toBe('session_quota');
    expect(refused.reply.headers.get('retry-after')).not.toBeNull();
    // Destroying two gives the room back to the pool, and it refills.
    for (const id of ids.slice(0, 2))
      expectStatus(await api.destroy(id), 200, `destroy ${id}`);
    await waitForPool(2, 'the pool to refill after the sessions went');
    for (const id of ids.slice(2))
      expectStatus(await api.destroy(id), 200, `destroy ${id}`);
    await waitForPool(POOL_SIZE, 'a full pool again');
  });

  step(
    'a standby that vanished is replaced, and a create still succeeds',
    async () => {
      const [victim] = await standbys();
      if (victim === undefined) throw new Error('no standby to remove');
      await admin.run([
        'stop',
        victim.name,
        '--project',
        lab.project,
        '--force',
      ]);
      const id = sessionId('lost');
      const result = await api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(result.reply, 201, 'create after a standby stopped');
      expect(await sh(api, id, 'id -u')).toBe('10001\n');
      await waitForPool(POOL_SIZE, 'the pool to heal');
      expect((await standbys()).map((s) => s.name)).not.toContain(victim.name);
      expectStatus(await api.destroy(id), 200, 'destroy');
    },
  );

  step(
    'a draining spawner stops keeping the pool; its replacement takes the standbys over',
    async () => {
      const waiting = new Set((await standbys()).map((s) => s.name));
      expect(waiting.size).toBe(POOL_SIZE);

      expectStatus(await api.drain(), 200, 'drain');
      const status = await api.drainStatus();
      expectStatus(status, 200, 'drain status');

      // The replacement boots beside the old one and adopts what is there.
      peer.start();
      await peer.ready();
      await until(
        'the replacement to count the standbys',
        async () => (await warm(peer.api)).ready === POOL_SIZE || undefined,
        {
          timeoutMs: 120_000,
        },
      );
      // The same instances: nothing was made again.
      expect(new Set((await standbys()).map((s) => s.name))).toEqual(waiting);

      // A claim by the replacement takes one of them.
      const id = sessionId('rollout');
      const result = await peer.api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(result.reply, 201, 'create on the replacement');
      report.add(
        'create from the warm pool, on a replacement spawner',
        result.elapsedMs,
      );
      expect(waiting.has((await sessionInstance(id))?.name ?? '')).toBe(true);
      await waitForPool(POOL_SIZE, 'the replacement to refill');
      // The draining one made none: the pool holds its size, not twice it.
      expect(await standbys()).toHaveLength(POOL_SIZE);
      expectStatus(await peer.api.destroy(id), 200, 'destroy');
    },
  );
});
