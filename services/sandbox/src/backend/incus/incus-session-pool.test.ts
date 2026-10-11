// A session create against a warm pool: the handout claims a standby, falls
// back to a cold start when it cannot, and the instance it leaves behind is
// found again by its label.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { SessionExistsError } from '../types.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
} from './incus-naming.ts';
import {
  sessionFixture,
  specOf,
  START_MS,
  tokenOf,
  type SessionFixture,
} from './incus-session-fixture.ts';
import { STANDBY_CLAIM_FILE } from './incus-standby.ts';
import { dockerCapableOverrides } from './incus-test-config.ts';
import { rejection } from './incus-test-support.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

const ID = 'sess_one';
const COLD_NAME = incusInstanceName(ID);

async function filled(options: Parameters<typeof sessionFixture>[0] = {}) {
  const f = sessionFixture({
    incus: { poolSize: 2 },
    maxSessions: 8,
    ...options,
  });
  const { pool } = await f.runtime.connect();
  await pool.reconcile();
  return { f, pool };
}

function standbys(f: SessionFixture) {
  return [...f.fake.instances.values()].filter((i) => i.config[LABEL.pool]);
}

function sessions(f: SessionFixture) {
  return [...f.fake.instances.values()].filter(
    (i) => i.config[LABEL.sandboxSession] === '1',
  );
}

describe('a create that claims a standby', () => {
  test('hands out a waiting instance instead of starting one', async () => {
    const { f, pool } = await filled();
    const createsBefore = f.fake.seen('POST /1.0/instances').length;
    const result = await f.backend.createSession(
      specOf(ID, { env: { KEY: 'value' } }),
    );
    expect(result).toEqual({
      resumed: false,
      incarnation: String(START_MS),
      egressAddress: '10.9.0.2',
    });
    // No instance was created for the session: it is a standby, relabelled.
    await pool.reconcile();
    const [session] = sessions(f);
    expect(session?.name.startsWith('tale-sbx-pool-')).toBe(true);
    expect(f.fake.instances.has(COLD_NAME)).toBe(false);
    expect(session?.config).toMatchObject({
      [LABEL.session]: ID,
      [LABEL.createAttempt]: 'attempt-1',
      [LABEL.created]: String(START_MS),
    });
    expect(session?.devices.workspace?.source).toBe(
      incusWorkspaceVolumeName(ID),
    );
    // The claim's token is the session's, and runnerd was seeded.
    expect(session?.bootEnv?.TALE_RUNNERD_TOKEN).toBe(tokenOf(f.cfg, ID));
    expect(f.runnerd.patches[0]).toMatchObject({ set: { KEY: 'value' } });
    // The only instances created since are the pool's refill.
    const created = f.fake.seen('POST /1.0/instances').length - createsBefore;
    expect(created).toBe(1);
  });

  test('refills the pool behind the claim, within the capacity', async () => {
    const { f, pool } = await filled({ maxSessions: 3 });
    await f.backend.createSession(specOf(ID));
    await pool.reconcile();
    expect(sessions(f)).toHaveLength(1);
    // 3 slots: one session, and the pool takes what is left.
    expect(standbys(f)).toHaveLength(2);
  });

  test('finds the claimed instance by its label, wherever it is asked', async () => {
    const { f } = await filled();
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.sessionExists(ID, START_MS)).toBe(true);
    const endpoint = await f.backend.resolveEndpoint(ID, START_MS);
    expect(endpoint).toBe(`http://${sessions(f)[0]?.address}:8200`);
    await f.backend.setPinned(ID, true, START_MS);
    expect((await f.backend.listSessions())[0]).toMatchObject({
      sessionId: ID,
      pinned: true,
    });
    expect((await f.backend.listWorkspaces())[0]).toMatchObject({
      sessionId: ID,
      active: true,
    });
  });

  test('stops the claimed instance like any other, and keeps the workspace', async () => {
    const { f, pool } = await filled();
    await f.backend.createSession(specOf(ID));
    await pool.reconcile();
    expect(await f.backend.stopSession(ID, START_MS)).toBe(true);
    expect(sessions(f)).toHaveLength(0);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName(ID))).toBe(true);
    // A resume claims again.
    const resumed = await f.backend.createSession(
      specOf(ID, { createdAtMs: START_MS + 1 }),
    );
    expect(resumed.resumed).toBe(true);
    expect(sessions(f)).toHaveLength(1);
  });

  test('a restarted spawner re-adopts the claimed instance too', async () => {
    const { f } = await filled();
    await f.backend.createSession(specOf(ID));
    const restarted = f.restart();
    expect((await restarted.listSessions()).map((s) => s.sessionId)).toEqual([
      ID,
    ]);
    expect(await restarted.destroySession(ID)).toBe(true);
    expect(sessions(f)).toHaveLength(0);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName(ID))).toBe(false);
  });

  test('removes the claimed instance when the create then fails', async () => {
    const { f, pool } = await filled();
    f.runnerd.failFirst = 1_000_000;
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('runnerd did not become ready');
    await pool.reconcile();
    expect(sessions(f)).toHaveLength(0);
    expect(f.fake.volumes.has(incusWorkspaceVolumeName(ID))).toBe(true);
  });
});

describe('a create the pool cannot serve', () => {
  test('starts cold while no standby is ready', async () => {
    const f = sessionFixture({ incus: { poolSize: 2 }, maxSessions: 8 });
    await f.backend.createSession(specOf(ID));
    expect(f.fake.instances.has(COLD_NAME)).toBe(true);
  });

  test('starts a render session cold: standbys are for agents', async () => {
    const { f, pool } = await filled();
    await f.backend.createSession(specOf(ID, { profile: 'default' }));
    await pool.reconcile();
    expect(f.fake.instances.has(COLD_NAME)).toBe(true);
    expect(standbys(f)).toHaveLength(2);
  });

  test('starts cold a session whose Docker capability differs from the standbys', async () => {
    // The deployment allows Docker inside, so the standbys have it; this
    // session asks to go without.
    const { f } = await filled({ overrides: dockerCapableOverrides() });
    await f.backend.createSession(specOf(ID, { docker: false }));
    expect(f.fake.instances.has(COLD_NAME)).toBe(true);
    expect(f.fake.instances.get(COLD_NAME)?.config[LABEL.docker]).toBe('false');
    expect(standbys(f)).toHaveLength(2);
  });

  test('claims a standby for a session that has the capability they have', async () => {
    const { f } = await filled({ overrides: dockerCapableOverrides() });
    await f.backend.createSession(specOf(ID));
    expect(f.fake.instances.has(COLD_NAME)).toBe(false);
    const [session] = sessions(f);
    expect(session?.config[LABEL.docker]).toBe('true');
    // The claim boots it as the Docker-capable root the entrypoint drops
    // itself from: no uid is handed over.
    expect(session?.files.get(STANDBY_CLAIM_FILE)?.content).not.toContain(
      'TALE_STANDBY_UID',
    );
  });

  test('falls back to a cold start when the node refuses the claim, and the standby stays', async () => {
    const { f } = await filled();
    const before = standbys(f).map((s) => s.name);
    f.fake.fail({
      match: 'PATCH /1.0/instances/*',
      status: 500,
      message: 'busy',
    });
    const result = await f.backend.createSession(specOf(ID));
    expect(result.resumed).toBe(false);
    expect(f.fake.instances.has(COLD_NAME)).toBe(true);
    expect(f.fake.instances.get(COLD_NAME)?.status).toBe('Running');
    // The standby was not at fault: it is still one.
    expect(standbys(f).map((s) => s.name)).toEqual(before);
  });

  test('falls back to a cold start, and drops the instance, when the claim could not be delivered', async () => {
    const { f } = await filled();
    f.fake.fail({
      match: 'POST /1.0/instances/*/files',
      status: 500,
      message: 'forkfile failed',
    });
    const result = await f.backend.createSession(specOf(ID));
    expect(result.resumed).toBe(false);
    expect(f.fake.instances.get(COLD_NAME)?.status).toBe('Running');
    // The one the claim turned into this session's was removed, and nothing
    // else carries the session's label.
    expect(
      sessions(f).filter(
        (i) => i.config[LABEL.session] === ID && i.name !== COLD_NAME,
      ),
    ).toEqual([]);
  });

  test('a cold start gives a standby’s slot back when the capacity is full', async () => {
    const { f, pool } = await filled({
      maxSessions: 3,
      incus: { poolSize: 3 },
    });
    expect(standbys(f)).toHaveLength(3);
    await f.backend.createSession(specOf(ID, { profile: 'default' }));
    // 3 slots: the session's, and two standbys.
    expect(standbys(f)).toHaveLength(2);
    await pool.reconcile();
    expect(standbys(f)).toHaveLength(2);
  });

  test('does not claim a standby for a session that already runs', async () => {
    const { f, pool } = await filled();
    f.fake.seedInstance(COLD_NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.created]: '1',
    });
    const ready = pool.readyCount();
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error).toBeInstanceOf(SessionExistsError);
    expect(pool.readyCount()).toBe(ready);
    expect(standbys(f)).toHaveLength(2);
  });
});
