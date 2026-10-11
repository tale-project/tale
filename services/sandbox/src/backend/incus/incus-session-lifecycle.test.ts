// A session after it exists on Incus: looking it up, fencing, stopping and
// destroying it, the pin, listing, workspaces, and re-adoption by a spawner
// that did not make it.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import {
  SessionIncarnationChangedError,
  type BackendSession,
} from '../types.ts';
import { INCUS_STATUS } from './incus-api.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
} from './incus-naming.ts';
import { sessionFixture, specOf, START_MS } from './incus-session-fixture.ts';
import { rejection } from './incus-test-support.ts';

let warn: ReturnType<typeof spyOn<typeof console, 'warn'>>;

beforeEach(() => {
  warn = spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  warn.mockRestore();
});

const ID = 'sess_one';
const NAME = incusInstanceName(ID);
const VOLUME = incusWorkspaceVolumeName(ID);

/** The labels of a session instance, as a create writes them. */
function labels(id = ID, extra: Record<string, string> = {}) {
  return {
    [LABEL.sandboxSession]: '1',
    [LABEL.session]: id,
    [LABEL.organization]: 'org_one',
    [LABEL.profile]: 'agent',
    [LABEL.docker]: 'false',
    [LABEL.created]: String(START_MS),
    ...extra,
  };
}

describe('sessionExists', () => {
  test('is true for a running session and false for none', async () => {
    const f = sessionFixture();
    expect(await f.backend.sessionExists(ID)).toBe(false);
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.sessionExists(ID)).toBe(true);
  });

  test('is false for an instance that is not running', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(NAME, labels(), {
      status: 'Stopped',
      ephemeral: false,
    });
    expect(await f.backend.sessionExists(ID)).toBe(false);
  });

  test('tells incarnations apart by the creation stamp', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.sessionExists(ID, START_MS)).toBe(true);
    expect(await f.backend.sessionExists(ID, START_MS + 1)).toBe(false);
  });

  test('throws, rather than guess, when the stamp cannot be read', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
    });
    expect(await f.backend.sessionExists(ID)).toBe(true);
    const error = await rejection(f.backend.sessionExists(ID, START_MS));
    expect(error.message).toContain('creation stamp is unreadable');
  });

  test('throws when Incus cannot answer: unknown is not gone', async () => {
    const f = sessionFixture();
    f.fake.fail({
      match: 'GET /1.0/instances/*',
      status: 500,
      message: 'database is locked',
    });
    const error = await rejection(f.backend.sessionExists(ID));
    expect(error.message).toContain('database is locked');
  });

  test('does not take an instance of another spawner for the session', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(
      NAME,
      labels(ID, { [LABEL.spawnerInstance]: 'device' }),
    );
    expect(await f.backend.sessionExists(ID)).toBe(false);
  });
});

describe('resolveEndpoint', () => {
  test('is the address of the instance on the runnerd port', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    const address = f.fake.instances.get(NAME)?.address;
    expect(address).toBeDefined();
    expect(await f.backend.resolveEndpoint(ID)).toBe(`http://${address}:8200`);
    expect(await f.backend.resolveEndpoint(ID, START_MS)).toBe(
      `http://${address}:8200`,
    );
  });

  test('refuses another incarnation, and an instance that is gone', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    const changed = await rejection(
      f.backend.resolveEndpoint(ID, START_MS + 5),
    );
    expect(changed).toBeInstanceOf(SessionIncarnationChangedError);
    await f.backend.stopSession(ID);
    const gone = await rejection(f.backend.resolveEndpoint(ID, START_MS));
    expect(gone).toBeInstanceOf(SessionIncarnationChangedError);
    const none = await rejection(f.backend.resolveEndpoint(ID));
    expect(none).not.toBeInstanceOf(SessionIncarnationChangedError);
    expect(none.message).toContain('no instance');
  });

  test('says so when the instance has no address yet', async () => {
    const f = sessionFixture();
    f.fake.assignAddresses = false;
    f.fake.seedInstance(NAME, labels());
    const error = await rejection(f.backend.resolveEndpoint(ID));
    expect(error.message).toContain('no address');
  });
});

describe('stopSession', () => {
  test('removes the instance, keeps the workspace, and says it existed', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.stopSession(ID, START_MS)).toBe(true);
    expect(f.fake.instances.has(NAME)).toBe(false);
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
    expect(f.fake.seen('PUT /1.0/instances/*/state')[0]?.body).toMatchObject({
      action: 'stop',
      force: true,
    });
    // Idempotent: nothing is left to stop.
    expect(await f.backend.stopSession(ID, START_MS)).toBe(false);
  });

  test('gives a busy session its grace before it is killed', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    await f.backend.stopSession(ID, START_MS, { graceMs: 30_000 });
    expect(
      f.fake.seen('PUT /1.0/instances/*/state').map((r) => r.body),
    ).toMatchObject([
      { action: 'stop', force: false, timeout: 30 },
      { action: 'stop', force: true },
    ]);
  });

  test('is fenced: another incarnation is refused and not touched', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    const error = await rejection(f.backend.stopSession(ID, START_MS - 1));
    expect(error).toBeInstanceOf(SessionIncarnationChangedError);
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
    expect(f.fake.seen('PUT /1.0/instances/*/state')).toHaveLength(0);
  });

  test('does not count a replacement that took the name while it terminated as freed', async () => {
    let swapped = false;
    const f = sessionFixture({
      onSleep: () => {
        if (swapped) return;
        swapped = true;
        f.fake.instances.delete(NAME);
        f.fake.seedInstance(NAME, labels(ID, { [LABEL.created]: '99' }));
      },
    });
    f.fake.seedInstance(NAME, labels(), { ephemeral: false });
    const error = await rejection(f.backend.stopSession(ID, START_MS));
    expect(error).toBeInstanceOf(SessionIncarnationChangedError);
    // The replacement runs on.
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
  });

  test('takes the scratch volume of a render session with it', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID, { profile: 'default' }));
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
    await f.backend.stopSession(ID);
    expect(f.fake.volumes.has(VOLUME)).toBe(false);
  });

  test('throws when the instance cannot be made to go: the reaper tries again', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'PUT /1.0/instances/*/state',
      status: 500,
      message: 'cannot stop',
      times: 100,
    });
    f.fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'cannot delete',
      times: 100,
    });
    const error = await rejection(f.backend.stopSession(ID, START_MS));
    expect(error.message).toContain('still there after its removal');
    expect(f.fake.instances.has(NAME)).toBe(true);
  });
});

describe('destroySession', () => {
  test('removes the instance and deletes the workspace', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.destroySession(ID)).toBe(true);
    expect(f.fake.instances.has(NAME)).toBe(false);
    expect(f.fake.volumes.has(VOLUME)).toBe(false);
    expect(await f.backend.destroySession(ID)).toBe(false);
  });

  test('destroys the workspace of a session that is stopped', async () => {
    const f = sessionFixture();
    f.fake.seedVolume(VOLUME, { [LABEL.session]: ID });
    expect(await f.backend.destroySession(ID)).toBe(true);
    expect(f.fake.volumes.has(VOLUME)).toBe(false);
  });

  test('leaves the workspace alone when the instance is still there', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'PUT /1.0/instances/*/state',
      status: 500,
      message: 'cannot stop',
      times: 100,
    });
    f.fake.fail({
      match: 'DELETE /1.0/instances/*',
      status: 500,
      message: 'cannot delete',
      times: 100,
    });
    const error = await rejection(f.backend.destroySession(ID));
    expect(error.message).toContain('still there');
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
  });

  test('throws, and says what is left, when the workspace cannot be deleted', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'DELETE /1.0/storage-pools/*/volumes/custom/*',
      status: 500,
      message: 'dataset is busy',
      times: 100,
    });
    const error = await rejection(f.backend.destroySession(ID));
    expect(error.message).toContain(
      'instance removed but its workspace volume could not be deleted',
    );
    expect(error.message).toContain('dataset is busy');
    // The instance is gone, so a second destroy only has the volume to do.
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('leaves the workspace alone when another instance still carries the session', async () => {
    const f = sessionFixture();
    // A claimed standby and a cold start for one id: the one listed goes,
    // and the other must not let the workspace be deleted under it.
    f.fake.seedInstance(
      'tale-sbx-pool-s0001',
      labels(ID, { [LABEL.created]: '9' }),
    );
    f.fake.seedInstance(NAME, labels(ID, { [LABEL.created]: '5' }));
    f.fake.seedVolume(VOLUME, { [LABEL.session]: ID });
    const error = await rejection(f.backend.destroySession(ID));
    expect(error.message).toContain('still present after removal');
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
    expect(f.fake.instances.has('tale-sbx-pool-s0001')).toBe(true);
  });

  test('waits out a volume an instance has only just let go of', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'DELETE /1.0/storage-pools/*/volumes/custom/*',
      status: 400,
      message: 'Storage volume is in use by an instance',
      times: 2,
    });
    expect(await f.backend.destroySession(ID)).toBe(true);
    expect(f.fake.volumes.has(VOLUME)).toBe(false);
    expect(
      f.fake.seen('DELETE /1.0/storage-pools/*/volumes/custom/*'),
    ).toHaveLength(3);
  });
});

describe('workspaceDeletion', () => {
  test('is done once the volume is gone', async () => {
    const f = sessionFixture();
    expect(await f.backend.workspaceDeletion(ID)).toBe('done');
    await f.backend.createSession(specOf(ID));
    expect(await f.backend.workspaceDeletion(ID)).toBe('pending');
    await f.backend.destroySession(ID);
    expect(await f.backend.workspaceDeletion(ID)).toBe('done');
  });

  test('waits for a volume that is going, as long as it is told, and never deletes it itself', async () => {
    const f = sessionFixture({
      onSleep: () => {
        f.fake.volumes.delete(VOLUME);
      },
    });
    f.fake.seedVolume(VOLUME, { [LABEL.session]: ID });
    expect(await f.backend.workspaceDeletion(ID, 2_000)).toBe('done');

    const g = sessionFixture();
    g.fake.seedVolume(VOLUME, { [LABEL.session]: ID });
    expect(await g.backend.workspaceDeletion(ID, 1_000)).toBe('pending');
    expect(g.fake.volumes.has(VOLUME)).toBe(true);
    expect(g.fake.seen('DELETE /1.0/storage-pools/*/volumes/custom/*')).toEqual(
      [],
    );
  });
});

describe('setPinned', () => {
  test('writes the pin on the instance, and listing reads it back', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    await f.backend.setPinned(ID, true, START_MS);
    expect(f.fake.instances.get(NAME)?.config[LABEL.pinned]).toBe('true');
    const patch = f.fake.seen('PATCH /1.0/instances/*')[0];
    expect(patch?.headers['if-match']).toBeDefined();
    expect((await f.backend.listSessions())[0]?.pinned).toBe(true);

    await f.backend.setPinned(ID, false, START_MS);
    expect(f.fake.instances.get(NAME)?.config[LABEL.pinned]).toBeUndefined();
    expect((await f.backend.listSessions())[0]?.pinned).toBe(false);
  });

  test('looks again when the instance changed since it was read', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'PATCH /1.0/instances/*',
      status: 412,
      message: "ETag doesn't match",
    });
    await f.backend.setPinned(ID, true);
    expect(f.fake.instances.get(NAME)?.config[LABEL.pinned]).toBe('true');
    expect(f.fake.seen('PATCH /1.0/instances/*')).toHaveLength(2);
  });

  test('gives up when it keeps changing', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    f.fake.fail({
      match: 'PATCH /1.0/instances/*',
      status: 412,
      message: "ETag doesn't match",
      times: 10,
    });
    const error = await rejection(f.backend.setPinned(ID, true));
    expect(error.message).toContain("ETag doesn't match");
    expect(f.fake.seen('PATCH /1.0/instances/*')).toHaveLength(3);
  });

  test('is fenced to the incarnation it was asked about', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    const error = await rejection(f.backend.setPinned(ID, true, START_MS + 1));
    expect(error).toBeInstanceOf(SessionIncarnationChangedError);
    expect(f.fake.seen('PATCH /1.0/instances/*')).toHaveLength(0);
  });

  test('has nothing to pin when there is no instance', async () => {
    const f = sessionFixture();
    await f.backend.setPinned(ID, false);
    const none = await rejection(f.backend.setPinned(ID, true));
    expect(none.message).toContain('no instance to pin');
    const fenced = await rejection(f.backend.setPinned(ID, true, START_MS));
    expect(fenced).toBeInstanceOf(SessionIncarnationChangedError);
    expect(f.fake.seen('PATCH /1.0/instances/*')).toHaveLength(0);
  });

  test('a new create starts unpinned whatever its predecessor recorded', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    await f.backend.setPinned(ID, true);
    await f.backend.stopSession(ID);
    await f.backend.createSession(specOf(ID, { createdAtMs: START_MS + 10 }));
    expect((await f.backend.listSessions())[0]?.pinned).toBe(false);
  });
});

describe('reapStaleSession', () => {
  /** An instance whose start was abandoned; the clock stands `afterMs` past
   * the end of its create's budget and slack. */
  function stuck(
    afterMs: number,
    status: 'Stopped' | 'Error' | 'Running',
    extra: Record<string, string> = {},
  ) {
    const f = sessionFixture();
    const instance = f.fake.seedInstance(
      NAME,
      labels(ID, { [LABEL.created]: String(START_MS), ...extra }),
      { status, ephemeral: false },
    );
    // Incus's own creation time is what keeps a new instance safe, whatever
    // stamp the creator gave it.
    const born = Math.max(Date.parse(instance.createdAt), START_MS);
    f.clock.now = born + f.cfg.session.createHealthTimeoutMs + 60_000 + afterMs;
    return { f, born };
  }

  test('removes an instance that never started, past its budget and slack', async () => {
    const { f } = stuck(1_000, 'Stopped');
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(true);
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('keeps the workspace of what it reaps', async () => {
    const { f } = stuck(1_000, 'Error');
    f.fake.seedVolume(VOLUME, { [LABEL.session]: ID });
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(true);
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
  });

  test('leaves an instance still inside its budget', async () => {
    const { f } = stuck(-30_000, 'Stopped');
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(false);
    expect(f.fake.instances.has(NAME)).toBe(true);
  });

  test('works to the deadline its creator declared, not its own timeout', async () => {
    // A peer with a longer create timeout is still starting.
    const born = Date.parse(
      sessionFixture().fake.seedInstance('probe', {}).createdAt,
    );
    const { f } = stuck(1_000, 'Stopped', {
      [LABEL.startupDeadline]: String(Math.max(born, START_MS) + 600_000),
    });
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(false);
    expect(f.fake.instances.has(NAME)).toBe(true);
  });

  test('never reaps a running one', async () => {
    const { f } = stuck(10 * 60_000, 'Running');
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(false);
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
  });

  test('is fenced to the incarnation listed', async () => {
    const { f } = stuck(10 * 60_000, 'Error');
    expect(await f.backend.reapStaleSession(ID, START_MS + 1)).toBe(false);
    expect(f.fake.instances.has(NAME)).toBe(true);
  });

  test('has nothing to do for an instance that is gone', async () => {
    const f = sessionFixture();
    expect(await f.backend.reapStaleSession(ID, START_MS)).toBe(true);
  });
});

describe('listSessions', () => {
  test('describes the session instances from their labels', async () => {
    const f = sessionFixture();
    await f.backend.createSession(
      specOf(ID, { organizationId: 'org_two', docker: false }),
    );
    expect(await f.backend.listSessions()).toEqual<BackendSession[]>([
      {
        sessionId: ID,
        organizationId: 'org_two',
        profile: 'agent',
        docker: false,
        createdAtMs: START_MS,
        ttlMs: f.cfg.session.maxLifetimeMs,
        idleTimeoutMs: f.cfg.session.maxIdleMs,
        state: 'ready',
        pinned: false,
        ended: false,
        egressAddress: '10.9.0.2',
      },
    ]);
  });

  test('filters by organization', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf('a', { organizationId: 'org_a' }));
    await f.backend.createSession(specOf('b', { organizationId: 'org_b' }));
    expect(
      (await f.backend.listSessions('org_b')).map((s) => s.sessionId),
    ).toEqual(['b']);
    expect(await f.backend.listSessions()).toHaveLength(2);
  });

  test('reads an instance that is not running as degraded, and an ended one as ended', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-ses-starting', labels('s1'), {
      status: 'Starting',
    });
    f.fake.seedInstance('tale-sbx-ses-dead', labels('s2'), {
      status: 'Error',
      ephemeral: false,
    });
    const sessions = new Map(
      (await f.backend.listSessions()).map((s) => [s.sessionId, s]),
    );
    expect(sessions.get('s1')).toMatchObject({
      state: 'degraded',
      ended: false,
    });
    expect(sessions.get('s2')).toMatchObject({
      state: 'degraded',
      ended: true,
    });
  });

  test('lists only the sessions of this spawner: no standbys, no strangers, no other spawner’s', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-pool-x', { [LABEL.pool]: 'fp' });
    f.fake.seedInstance('someone-elses', {});
    f.fake.seedInstance(
      'tale-sbx-ses-device',
      labels('dev', { [LABEL.spawnerInstance]: 'device' }),
    );
    f.fake.seedInstance('tale-sbx-ses-mine', labels('mine'));
    expect((await f.backend.listSessions()).map((s) => s.sessionId)).toEqual([
      'mine',
    ]);
  });

  test('lists the one that stands for a session when two carry its label', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(
      'tale-sbx-pool-old',
      labels(ID, { [LABEL.created]: '5' }),
      {
        status: 'Starting',
      },
    );
    f.fake.seedInstance(NAME, labels(ID, { [LABEL.created]: '9' }));
    const sessions = await f.backend.listSessions();
    expect(sessions).toHaveLength(1);
    expect(sessions[0]).toMatchObject({ createdAtMs: 9, state: 'ready' });
    expect(
      warn.mock.calls.some((call) => String(call[0]).includes('2 instances')),
    ).toBe(true);
  });

  test('throws on a failed list, never answers an empty one for it', async () => {
    const f = sessionFixture();
    f.fake.fail({
      match: 'GET /1.0/instances',
      status: 500,
      message: 'database is locked',
    });
    const error = await rejection(f.backend.listSessions());
    expect(error.message).toContain('database is locked');
  });

  test('reads a session without the optional labels as the oldest runtime objects', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
    });
    const [session] = await f.backend.listSessions();
    expect(session).toMatchObject({
      profile: 'default',
      organizationId: '',
      createdAtMs: 0,
    });
    expect(session).not.toHaveProperty('docker');
    expect(session).not.toHaveProperty('egressAddress');
  });
});

describe('workspaces', () => {
  test('lists every workspace volume, joined with the instances beside them', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf('live', { organizationId: 'org_a' }));
    await f.backend.setPinned('live', true);
    // A stopped session's workspace, and one an organization-less create left.
    f.fake.seedVolume(incusWorkspaceVolumeName('parked'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'parked',
      [LABEL.organization]: 'org_b',
      [LABEL.profile]: 'agent',
    });
    const workspaces = await f.backend.listWorkspaces();
    expect(workspaces.map((w) => w.sessionId).sort()).toEqual([
      'live',
      'parked',
    ]);
    expect(workspaces.find((w) => w.sessionId === 'live')).toMatchObject({
      active: true,
      pinned: true,
      organizationId: 'org_a',
    });
    expect(workspaces.find((w) => w.sessionId === 'parked')).toMatchObject({
      active: false,
      pinned: false,
      organizationId: 'org_b',
    });
  });

  test('does not list a render scratch, a stranger’s volume, or another spawner’s', async () => {
    const f = sessionFixture();
    f.fake.seedVolume(incusWorkspaceVolumeName('scratch'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'scratch',
      [LABEL.profile]: 'default',
    });
    f.fake.seedVolume('somebody-elses', {});
    f.fake.seedVolume(incusWorkspaceVolumeName('device'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'device',
      [LABEL.profile]: 'agent',
      [LABEL.spawnerInstance]: 'device',
    });
    f.fake.seedVolume(incusWorkspaceVolumeName('odd'), {
      [LABEL.workspace]: '1',
      [LABEL.session]: 'not valid!',
      [LABEL.profile]: 'agent',
    });
    expect(await f.backend.listWorkspaces()).toEqual([]);
  });

  test('throws when the volumes or the instances cannot be listed', async () => {
    const f = sessionFixture();
    f.fake.fail({
      match: 'GET /1.0/storage-pools/*/volumes/custom',
      status: 500,
      message: 'pool busy',
    });
    expect((await rejection(f.backend.listWorkspaces())).message).toContain(
      'pool busy',
    );
    f.fake.fail({
      match: 'GET /1.0/instances',
      status: 500,
      message: 'database is locked',
    });
    expect((await rejection(f.backend.listWorkspaces())).message).toContain(
      'database is locked',
    );
  });

  test('knows a workspace by its volume or by its instance', async () => {
    const f = sessionFixture();
    expect(await f.backend.hasWorkspace(ID)).toBe(false);
    f.fake.seedVolume(VOLUME, {});
    expect(await f.backend.hasWorkspace(ID)).toBe(true);
    f.fake.volumes.clear();
    f.fake.seedInstance(NAME, labels());
    expect(await f.backend.hasWorkspace(ID)).toBe(true);
  });
});

describe('after a spawner restart', () => {
  test('remembers where a label scan found the session, and scans once', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-pool-s0001', labels());
    const restarted = f.restart();
    await restarted.sessionExists(ID);
    const scans = f.fake.seen('GET /1.0/instances').length;
    expect(scans).toBe(1);
    expect(await restarted.sessionExists(ID)).toBe(true);
    expect(await restarted.sessionExists(ID)).toBe(true);
    expect(f.fake.seen('GET /1.0/instances').length).toBe(scans);
  });

  test('re-adopts what is there from the labels: listing, endpoint, pin, stop', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    await f.backend.setPinned(ID, true);
    const restarted = f.restart();

    const [session] = await restarted.listSessions();
    expect(session).toMatchObject({
      sessionId: ID,
      createdAtMs: START_MS,
      pinned: true,
      state: 'ready',
    });
    expect(await restarted.resolveEndpoint(ID, START_MS)).toContain(':8200');
    expect(await restarted.sessionExists(ID, START_MS)).toBe(true);
    expect(await restarted.stopSession(ID, START_MS)).toBe(true);
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('finds a session whose instance carries another name by its label', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-pool-s0001', labels());
    const restarted = f.restart();
    expect(await restarted.sessionExists(ID, START_MS)).toBe(true);
    expect(await restarted.resolveEndpoint(ID)).toContain(':8200');
    await restarted.setPinned(ID, true);
    expect(
      f.fake.instances.get('tale-sbx-pool-s0001')?.config[LABEL.pinned],
    ).toBe('true');
    expect(await restarted.destroySession(ID)).toBe(true);
    expect(f.fake.instances.size).toBe(0);
  });

  test('keeps a session found under a claimed name addressable without another scan', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-pool-s0001', labels());
    const restarted = f.restart();
    await restarted.listSessions();
    const before = f.fake.seen('GET /1.0/instances').length;
    await restarted.sessionExists(ID);
    expect(f.fake.seen('GET /1.0/instances').length).toBe(before);
  });
});

describe('small contracts', () => {
  test('the egress address a new session would pin is the configured literal', async () => {
    const f = sessionFixture();
    expect(await f.backend.egressAddress()).toBe('10.9.0.2');
    const g = sessionFixture({ overrides: { transparentEgress: false } });
    expect(await g.backend.egressAddress()).toBeNull();
  });

  test('has no organization resources and no build cache', async () => {
    const f = sessionFixture();
    expect(await f.backend.listOrganizationResources()).toEqual([]);
    expect(await f.backend.teardownOrganization()).toEqual({
      containers: 0,
      volumes: 0,
      networks: 0,
    });
    await f.backend.reconcileBuildCache();
    expect(f.fake.requests).toEqual([]);
  });

  test('is the incus kind', () => {
    expect(sessionFixture().backend.kind).toBe('incus');
    expect(INCUS_STATUS.running).toBe(103);
  });
});
