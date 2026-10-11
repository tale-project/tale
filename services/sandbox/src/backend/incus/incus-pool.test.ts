// The warm pool against the fake Incus: how it fills, how far, what it
// replaces, and what a claim does to a standby.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { withOperationBudget } from '../../operation-budget.ts';
import type { SpawnerConfig } from '../../types.ts';
import { FakeIncus } from './fake-incus.ts';
import { incusWorkspaceVolumeName, LABEL } from './incus-naming.ts';
import { IncusPool } from './incus-pool.ts';
import {
  poolFingerprint,
  poolShape,
  sessionShape,
  type SessionInstanceInput,
} from './incus-session-spec.ts';
import {
  STANDBY_CLAIM_FILE,
  STANDBY_READY_FILE,
  STANDBY_SCRIPT_PATH,
} from './incus-standby.ts';
import { incusTestConfig } from './incus-test-config.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

/** A pool on a virtual clock: sleeping moves time, and costs none. */
function fixture(
  poolSize: number,
  options: {
    maxSessions?: number;
    inFlight?: string[];
    cfg?: SpawnerConfig;
  } = {},
) {
  const fake = new FakeIncus();
  const cfg =
    options.cfg ??
    incusTestConfig(
      { poolSize },
      {
        session: {
          ...incusTestConfig().session,
          maxSessions: options.maxSessions ?? 10,
        },
      },
    );
  const clock = { now: 1_700_000_000_000 };
  let counter = 0;
  const inFlight = new Set(options.inFlight ?? []);
  /** Another spawner process over the same Incus, on the same clock. */
  const poolFor = (config: SpawnerConfig) =>
    new IncusPool(config, fake.client(), {
      now: () => clock.now,
      sleep: async (ms) => {
        clock.now += ms;
      },
      randomId: () => `id${(counter++).toString(16).padStart(4, '0')}`,
      inFlight: () => inFlight,
    });
  return { fake, cfg, pool: poolFor(cfg), poolFor, clock, inFlight };
}

const claimInput: SessionInstanceInput = {
  sessionId: 'sess_claimed',
  organizationId: 'org_one',
  profile: 'agent',
  createdAtMs: 1_700_000_001_000,
  createAttemptId: 'attempt-9',
  runnerdToken: 'c0ffee',
  egressAddress: '10.9.0.2',
  startupDeadlineMs: 1_700_000_006_000,
};

function standbys(fake: FakeIncus) {
  return [...fake.instances.values()].filter((i) => i.config[LABEL.pool]);
}

describe('filling the pool', () => {
  test('makes the standbys: created stopped, the script pushed, then started and waiting', async () => {
    const { fake, pool } = fixture(3);
    const report = await pool.reconcile();
    expect(report).toEqual({ created: 3, removed: 0, ready: 3 });
    expect(standbys(fake)).toHaveLength(3);
    for (const standby of standbys(fake)) {
      expect(standby.status).toBe('Running');
      expect(standby.files.get(STANDBY_SCRIPT_PATH)?.mode).toBe('0755');
      expect(standby.files.has(STANDBY_READY_FILE)).toBe(true);
      expect(standby.bootEnv).toBeUndefined();
    }
    // Per standby: created stopped, the script pushed, then started — in
    // that order, because the script has to be in the rootfs before the
    // instance first runs.
    const writes = fake.requests
      .filter((request) => ['POST', 'PUT'].includes(request.method))
      .map((request) => `${request.method} ${request.path}`);
    for (const standby of standbys(fake)) {
      const mine = writes.filter((entry) =>
        entry.includes(`/${standby.name}/`),
      );
      expect(mine).toEqual([
        `POST /1.0/instances/${standby.name}/files`,
        `PUT /1.0/instances/${standby.name}/state`,
      ]);
    }
    expect(fake.seen('POST /1.0/instances')).toHaveLength(3);
    for (const create of fake.seen('POST /1.0/instances')) {
      // Not ephemeral: its console must outlive a start that failed.
      expect(create.body).toMatchObject({ start: false, ephemeral: false });
    }
    expect(pool.readyCount()).toBe(3);
  });

  test('does nothing while the runtime image is not there, and keeps what it has', async () => {
    const { fake, pool } = fixture(2);
    await pool.reconcile();
    fake.aliases.clear();
    const report = await pool.reconcile();
    expect(report).toEqual({ created: 0, removed: 0, ready: 2 });
    expect(standbys(fake)).toHaveLength(2);
  });

  test('never exceeds the capacity together with the sessions', async () => {
    const { fake, pool } = fixture(4, { maxSessions: 5 });
    for (const id of ['a', 'b', 'c']) {
      fake.seedInstance(`tale-sbx-ses-${id}`, {
        [LABEL.sandboxSession]: '1',
        [LABEL.session]: id,
      });
    }
    const report = await pool.reconcile();
    expect(report.created).toBe(2);
    expect(fake.instances.size).toBe(5);
  });

  test('counts a create still in flight as a session', async () => {
    const { fake, pool } = fixture(4, { maxSessions: 5, inFlight: ['x', 'y'] });
    const report = await pool.reconcile();
    expect(report.created).toBe(3);
    expect(standbys(fake)).toHaveLength(3);
  });

  test('gives capacity back when sessions take it', async () => {
    const { fake, pool, inFlight } = fixture(4, { maxSessions: 5 });
    await pool.reconcile();
    expect(standbys(fake)).toHaveLength(4);
    for (const id of ['a', 'b', 'c']) inFlight.add(id);
    const report = await pool.reconcile();
    expect(report.removed).toBe(2);
    expect(standbys(fake)).toHaveLength(2);
  });

  test('is emptied by a size of zero', async () => {
    const { fake, pool, poolFor } = fixture(2);
    await pool.reconcile();
    const off = poolFor(incusTestConfig({ poolSize: 0 }));
    const report = await off.reconcile();
    expect(report.removed).toBe(2);
    expect(standbys(fake)).toHaveLength(0);
  });

  test('a standby that failed to be made is removed, and the next pass tries again', async () => {
    const { fake, pool } = fixture(1);
    fake.fail({
      match: 'POST /1.0/instances/*/files',
      status: 500,
      message: 'forkfile failed',
    });
    const first = await pool.reconcile();
    expect(first.created).toBe(0);
    expect(standbys(fake)).toHaveLength(0);
    expect(fake.instances.size).toBe(0);
    const second = await pool.reconcile();
    expect(second.created).toBe(1);
  });

  test('a standby that never says it waits is given up on', async () => {
    const { fake, pool } = fixture(1);
    fake.onStarted = (instance) => {
      instance.files.delete(STANDBY_READY_FILE);
    };
    const report = await pool.reconcile();
    expect(report.created).toBe(0);
    expect(fake.instances.size).toBe(0);
  });
});

describe('keeping the pool current', () => {
  test('replaces standbys made for another config', async () => {
    const { fake, pool, poolFor } = fixture(2);
    await pool.reconcile();
    const before = standbys(fake).map((s) => s.name);
    const moved = poolFor(
      incusTestConfig({ poolSize: 2 }, { egressProxy: 'http://10.9.0.3:3128' }),
    );
    const report = await moved.reconcile();
    expect(report.removed).toBe(2);
    expect(report.created).toBe(2);
    expect(standbys(fake).map((s) => s.name)).not.toEqual(before);
  });

  test('replaces standbys made from an image the alias has left', async () => {
    const { fake, pool } = fixture(2);
    await pool.reconcile();
    fake.addImage('tale-sandbox-runtime', '9'.repeat(64));
    const report = await pool.reconcile();
    expect(report.removed).toBe(2);
    expect(report.created).toBe(2);
    for (const standby of standbys(fake)) {
      expect(standby.config[LABEL.poolImage]).toBe('9'.repeat(64));
    }
  });

  test('replaces a standby that has stood too long', async () => {
    const { pool, clock } = fixture(1);
    await pool.reconcile();
    clock.now += 7 * 60 * 60 * 1000;
    const report = await pool.reconcile();
    expect(report).toMatchObject({ removed: 1, created: 1 });
  });

  test('removes a standby that is no longer running', async () => {
    const { fake, pool } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    only.status = 'Stopped';
    only.ephemeral = false;
    const report = await pool.reconcile();
    expect(report.removed).toBe(1);
    expect(fake.instances.has(only.name)).toBe(false);
    expect(report.created).toBe(1);
  });

  test('takes over the standbys a previous spawner left, once they wait', async () => {
    const first = fixture(2);
    await first.pool.reconcile();
    const second = first.poolFor(first.cfg);
    expect(second.readyCount()).toBe(0);
    const report = await second.reconcile();
    expect(report).toEqual({ created: 0, removed: 0, ready: 2 });
  });

  test('leaves another spawner instance’s standbys alone', async () => {
    const { fake, pool } = fixture(1);
    fake.seedInstance('tale-sbx-pool-other', {
      [LABEL.pool]: 'whatever',
      [LABEL.spawnerInstance]: 'device',
    });
    await pool.reconcile();
    expect(fake.instances.has('tale-sbx-pool-other')).toBe(true);
  });

  test('the fingerprint on a standby is the one the config makes', async () => {
    const { fake, pool, cfg } = fixture(1);
    await pool.reconcile();
    expect(standbys(fake)[0]?.config[LABEL.pool]).toBe(
      poolFingerprint(cfg, poolShape(cfg)),
    );
  });
});

describe('claiming a standby', () => {
  test('labels it as the session, mounts the workspace and has it boot with the token', async () => {
    const { fake, pool, cfg } = fixture(2);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    const name = await pool.claim(claimInput, sessionShape(cfg, 'agent'));
    expect(name).toBeDefined();
    const claimed = fake.instances.get(name ?? '');
    expect(claimed?.config).toMatchObject({
      'user.tale.sandbox-session': '1',
      'user.tale.session': 'sess_claimed',
      'user.tale.created': '1700000001000',
      'user.tale.create-attempt': 'attempt-9',
    });
    // The emptied pool labels read as removed.
    expect(claimed?.config[LABEL.pool]).toBeUndefined();
    expect(claimed?.devices.workspace).toMatchObject({
      pool: 'tank',
      path: '/agent',
      source: incusWorkspaceVolumeName('sess_claimed'),
    });
    expect(claimed?.files.get(STANDBY_CLAIM_FILE)?.mode).toBe('0600');
    // The script became the entrypoint: runnerd boots with the claim.
    expect(claimed?.bootEnv?.TALE_RUNNERD_TOKEN).toBe('c0ffee');
    expect(claimed?.bootEnv?.TALE_RUNNERD_INCARNATION).toBe('1700000001000');
    expect(claimed?.bootEnv?.HTTP_PROXY).toBe('http://10.9.0.2:3128');
  });

  test('refills the pool behind a claim', async () => {
    const { fake, pool, cfg } = fixture(2);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    await pool.claim(claimInput, sessionShape(cfg, 'agent'));
    await pool.reconcile();
    expect(standbys(fake)).toHaveLength(2);
    expect(fake.instances.size).toBe(3);
  });

  test('answers undefined when nothing waits, and takes a standby only once', async () => {
    const { fake, pool, cfg } = fixture(1);
    expect(
      await pool.claim(claimInput, sessionShape(cfg, 'agent')),
    ).toBeUndefined();
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    const both = await Promise.all([
      pool.claim(claimInput, sessionShape(cfg, 'agent')),
      pool.claim(
        { ...claimInput, sessionId: 'sess_two' },
        sessionShape(cfg, 'agent'),
      ),
    ]);
    expect(both.filter((name) => name !== undefined)).toHaveLength(1);
  });

  test('two claims take two standbys', async () => {
    const { fake, pool, cfg } = fixture(2);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    fake.seedVolume(incusWorkspaceVolumeName('sess_two'), {});
    const names = await Promise.all([
      pool.claim(claimInput, sessionShape(cfg, 'agent')),
      pool.claim(
        { ...claimInput, sessionId: 'sess_two' },
        sessionShape(cfg, 'agent'),
      ),
    ]);
    expect(new Set(names).size).toBe(2);
    expect(names.every((name) => name !== undefined)).toBe(true);
  });

  test('a claim that fails removes the standby and leaves the session to start cold', async () => {
    const { fake, pool, cfg } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    // No volume to mount: the hot-plug is refused.
    const name = await pool.claim(claimInput, sessionShape(cfg, 'agent'));
    expect(name).toBeUndefined();
    expect(fake.instances.has(only.name)).toBe(false);
    // Nothing of the failed claim is left on a session's name.
    expect(
      [...fake.instances.values()].filter(
        (i) => i.config[LABEL.session] !== undefined,
      ),
    ).toEqual([]);
    await pool.reconcile();
  });

  test('a standby changed by someone else since it was read is refused, not overwritten', async () => {
    const { fake, pool, cfg } = fixture(1);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    // A peer claims between this spawner's read and its write.
    fake.fail({
      match: 'PATCH /1.0/instances/*',
      status: 412,
      message: "ETag doesn't match",
    });
    expect(
      await pool.claim(claimInput, sessionShape(cfg, 'agent')),
    ).toBeUndefined();
    expect(fake.instances.has(only.name)).toBe(false);
    expect(only.files.has(STANDBY_CLAIM_FILE)).toBe(false);
    await pool.reconcile();
  });

  test('a standby that has stopped waiting is not handed out', async () => {
    const { fake, pool, cfg } = fixture(1);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    only.status = 'Stopped';
    only.ephemeral = false;
    expect(
      await pool.claim(claimInput, sessionShape(cfg, 'agent')),
    ).toBeUndefined();
    expect(fake.instances.has(only.name)).toBe(false);
    await pool.reconcile();
  });

  test('a standby the claim pushes into before it fails to start is not left claimed', async () => {
    const { fake, pool, cfg } = fixture(1);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    fake.fail({
      match: 'POST /1.0/instances/*/files',
      status: 500,
      message: 'forkfile failed',
    });
    expect(
      await pool.claim(claimInput, sessionShape(cfg, 'agent')),
    ).toBeUndefined();
    // The labels were already written: the instance must not stay a session
    // nobody is booting.
    expect(fake.instances.has(only.name)).toBe(false);
    await pool.reconcile();
  });
});

describe('the pool’s own work', () => {
  test('the refill behind a claim outlives the create it follows from', async () => {
    const { fake, pool, cfg } = fixture(2);
    await pool.reconcile();
    fake.seedVolume(incusWorkspaceVolumeName('sess_claimed'), {});
    // The refill's create is held at the node while the create that started it
    // ends: its budget is cancelled, as a request that is over is.
    const release = fake.hold('POST /1.0/instances');
    const caller = new AbortController();
    const name = await withOperationBudget(
      60_000,
      () => pool.claim(claimInput, sessionShape(cfg, 'agent')),
      caller.signal,
    );
    expect(name).toBeDefined();
    caller.abort(new Error('the request is over'));
    release();
    const report = await pool.reconcile();
    expect(report.created).toBe(1);
    expect(standbys(fake)).toHaveLength(2);
  });

  test('a standby a peer claimed since it was listed is not removed with the rest', async () => {
    const { fake, pool, poolFor } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    // The next pass finds it stale (another config) and means to remove it.
    const moved = poolFor(
      incusTestConfig({ poolSize: 1 }, { egressProxy: 'http://10.9.0.3:3128' }),
    );
    // Held at the re-read that precedes the removal.
    const release = fake.hold(`GET /1.0/instances/${only.name}`);
    const pass = moved.reconcile();
    const until = Date.now() + 2_000;
    while (
      fake.seen(`GET /1.0/instances/${only.name}`).length === 0 &&
      Date.now() < until
    ) {
      await Bun.sleep(5);
    }
    // A peer spawner claims it in the meantime.
    only.config[LABEL.sandboxSession] = '1';
    only.config[LABEL.session] = 'a_live_session';
    only.config[LABEL.pool] = '';
    release();
    const report = await pass;
    expect(report.removed).toBe(0);
    expect(fake.instances.get(only.name)?.status).toBe('Running');
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('claimed meanwhile'),
      ),
    ).toBe(true);
  });
});

describe('making room', () => {
  test('removes standbys until the sessions fit beside what is left', async () => {
    const { fake, pool } = fixture(4, { maxSessions: 6 });
    await pool.reconcile();
    expect(fake.instances.size).toBe(4);
    for (const id of ['a', 'b', 'c']) {
      fake.seedInstance(`tale-sbx-ses-${id}`, {
        [LABEL.sandboxSession]: '1',
        [LABEL.session]: id,
      });
    }
    // 3 sessions + 4 standbys + the one about to start = 8 against 6.
    await pool.makeRoom(1);
    expect(standbys(fake)).toHaveLength(2);
  });

  test('does nothing while there is room, or no pool', async () => {
    const { fake, pool } = fixture(2);
    await pool.reconcile();
    await pool.makeRoom(1);
    expect(standbys(fake)).toHaveLength(2);
    const off = fixture(0);
    await off.pool.makeRoom(1);
    expect(off.fake.requests).toHaveLength(0);
  });
});

describe('removing a standby', () => {
  test('a standby is stopped by force and then deleted', async () => {
    const { fake, pool } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    expect(only.ephemeral).toBe(false);
    only.config[LABEL.pool] = 'stale';
    const report = await pool.reconcile();
    expect(report).toMatchObject({ removed: 1, created: 1 });
    expect(fake.instances.has(only.name)).toBe(false);
    expect(fake.seen('DELETE /1.0/instances/*')).toHaveLength(1);
    // The stops of the first standby's start and of its removal.
    expect(
      fake.seen('PUT /1.0/instances/*/state').map((r) => r.body),
    ).toContainEqual(expect.objectContaining({ action: 'stop', force: true }));
  });

  test('an ephemeral instance somebody made goes with its stop and is not deleted again', async () => {
    const { fake, pool } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    only.ephemeral = true;
    only.config[LABEL.pool] = 'stale';
    const deletes = fake.seen('DELETE /1.0/instances/*').length;
    const report = await pool.reconcile();
    expect(report.removed).toBe(1);
    expect(fake.instances.has(only.name)).toBe(false);
    expect(fake.seen('DELETE /1.0/instances/*')).toHaveLength(deletes);
  });

  test('a standby that fails to start is quoted from its console before it is discarded', async () => {
    const { fake, pool } = fixture(1);
    fake.onStarted = (instance) => {
      instance.files.delete(STANDBY_READY_FILE);
      instance.consoleLog = 'standby.sh: mkdir: permission denied';
    };
    await pool.reconcile();
    const quoted = warn.mock.calls.some((call) =>
      call.some((part) => String(part).includes('mkdir: permission denied')),
    );
    expect(quoted).toBe(true);
    expect(fake.instances.size).toBe(0);
  });

  test('gives up on an instance that cannot be removed, and says so', async () => {
    const { fake, pool } = fixture(1);
    await pool.reconcile();
    const [only] = standbys(fake);
    if (only === undefined) throw new Error('no standby');
    only.config[LABEL.pool] = 'stale';
    fake.fail({
      match: 'PUT /1.0/instances/*/state',
      status: 500,
      message: 'cannot stop',
      times: 100,
    });
    fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'cannot delete',
      times: 100,
    });
    const report = await pool.reconcile();
    expect(report.removed).toBe(0);
    expect(warn).toHaveBeenCalled();
  });
});
