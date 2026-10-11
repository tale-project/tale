// Creating a session on Incus: what a create makes, in what order, what it
// leaves when it fails, and how it meets a session that is already there.

import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';

import { SessionExistsError } from '../types.ts';
import {
  incusInstanceName,
  incusWorkspaceVolumeName,
  LABEL,
} from './incus-naming.ts';
import { IncusSessionBackend } from './incus-session-backend.ts';
import {
  sessionFixture,
  specOf,
  START_MS,
  tokenOf,
} from './incus-session-fixture.ts';
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

describe('a cold create', () => {
  test('makes the workspace volume, then the instance, and answers once runnerd does', async () => {
    const f = sessionFixture();
    const result = await f.backend.createSession(
      specOf(ID, { env: { API_KEY: 'secret-value' } }),
    );
    expect(result).toEqual({
      resumed: false,
      incarnation: String(START_MS),
      egressAddress: '10.9.0.2',
    });

    const writes = f.fake.requests
      .filter((r) => r.method === 'POST')
      .map((r) => r.path);
    const volumeAt = writes.findIndex((path) =>
      path.endsWith('/volumes/custom'),
    );
    const instanceAt = writes.indexOf('/1.0/instances');
    expect(volumeAt).toBeGreaterThanOrEqual(0);
    expect(instanceAt).toBeGreaterThan(volumeAt);

    const volume = f.fake.volumes.get(VOLUME);
    expect(volume?.config).toMatchObject({
      size: '10GiB',
      'security.shifted': 'true',
      'user.tale.session': ID,
      'user.tale.org': 'org_one',
      'user.tale.sandbox-workspace': '1',
    });

    const instance = f.fake.instances.get(NAME);
    expect(instance).toBeDefined();
    expect(instance?.ephemeral).toBe(true);
    expect(instance?.status).toBe('Running');
    expect(instance?.devices.workspace?.source).toBe(VOLUME);
    expect(instance?.config).toMatchObject({
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.organization]: 'org_one',
      [LABEL.profile]: 'agent',
      [LABEL.created]: String(START_MS),
      [LABEL.createAttempt]: 'attempt-1',
      [LABEL.egress]: '10.9.0.2',
      'environment.TALE_RUNNERD_TOKEN': tokenOf(f.cfg, ID),
      'environment.TALE_RUNNERD_INCARNATION': String(START_MS),
    });
    // The create was a single call: made and started together.
    expect(f.fake.seen('POST /1.0/instances')[0]?.body).toMatchObject({
      start: true,
    });
  });

  test('gives runnerd the seed env after readiness, and never the instance', async () => {
    const f = sessionFixture();
    await f.backend.createSession(
      specOf(ID, { env: { API_KEY: 'secret-value' } }),
    );
    const instance = f.fake.instances.get(NAME);
    expect(f.runnerd.patches).toEqual([
      {
        baseUrl: `http://${instance?.address}:8200`,
        set: { API_KEY: 'secret-value' },
      },
    ]);
    // Nothing the platform seeds is readable from the instance.
    expect(JSON.stringify(f.fake.requests)).not.toContain('secret-value');
    for (const value of Object.values(instance?.config ?? {})) {
      expect(value).not.toContain('secret-value');
    }
    expect(f.runnerd.polls.length).toBeGreaterThan(0);
  });

  test('sends no patch for an empty seed env, and warns about denied keys', async () => {
    const f = sessionFixture();
    await f.backend.createSession(specOf(ID));
    expect(f.runnerd.patches).toEqual([]);

    const g = sessionFixture();
    g.runnerd.denied = ['PATH'];
    await g.backend.createSession(specOf(ID, { env: { PATH: '/evil' } }));
    expect(String(warn.mock.calls.at(-1)?.[0])).toContain('PATH');
  });

  test('waits for runnerd, polling until it answers', async () => {
    const f = sessionFixture();
    f.runnerd.failFirst = 4;
    await f.backend.createSession(specOf(ID));
    expect(f.runnerd.polls.length).toBe(5);
  });

  test('keeps waiting for the inner Docker of a Docker-capable session', async () => {
    const f = sessionFixture({
      overrides: { dockerInContainer: true },
      incus: {},
    });
    f.runnerd.dockerReady = false;
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('runnerd did not become ready');
    // The failed create took its instance away.
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('pins no egress address for a session without transparent egress', async () => {
    const f = sessionFixture({ overrides: { transparentEgress: false } });
    const result = await f.backend.createSession(specOf(ID));
    expect(result.egressAddress).toBeUndefined();
    expect(f.fake.instances.get(NAME)?.config[LABEL.egress]).toBeUndefined();
  });

  test('a render session gets a scratch volume, and no durable workspace', async () => {
    const f = sessionFixture();
    const result = await f.backend.createSession(
      specOf(ID, { profile: 'default' }),
    );
    expect(result.resumed).toBe(false);
    expect(f.fake.volumes.get(VOLUME)?.config['user.tale.profile']).toBe(
      'default',
    );
    expect(f.fake.instances.get(NAME)?.config[LABEL.profile]).toBe('default');
  });
});

describe('a resume', () => {
  test('mounts the workspace that is there, and says so', async () => {
    const f = sessionFixture();
    f.fake.seedVolume(VOLUME, {
      [LABEL.workspace]: '1',
      [LABEL.session]: ID,
      [LABEL.organization]: 'org_one',
      [LABEL.profile]: 'agent',
    });
    const result = await f.backend.createSession(specOf(ID));
    expect(result.resumed).toBe(true);
    expect(
      f.fake.seen('POST /1.0/storage-pools/*/volumes/custom'),
    ).toHaveLength(0);
    expect(f.fake.instances.get(NAME)?.devices.workspace?.source).toBe(VOLUME);
  });

  test('a render session starts from a scratch of its own, never the old one', async () => {
    const f = sessionFixture();
    f.fake.seedVolume(VOLUME, {
      [LABEL.workspace]: '1',
      [LABEL.session]: ID,
      [LABEL.profile]: 'default',
    });
    const result = await f.backend.createSession(
      specOf(ID, { profile: 'default' }),
    );
    expect(result.resumed).toBe(false);
    expect(
      f.fake.seen('DELETE /1.0/storage-pools/*/volumes/custom/*'),
    ).toHaveLength(1);
  });

  test('refuses a volume under the session’s name that belongs to another session', async () => {
    const f = sessionFixture();
    f.fake.seedVolume(VOLUME, { [LABEL.session]: 'someone_else' });
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('does not belong to session');
    expect(f.fake.instances.size).toBe(0);
  });

  test('removes a dead instance that holds the name, then creates', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(
      NAME,
      {
        [LABEL.sandboxSession]: '1',
        [LABEL.session]: ID,
        [LABEL.created]: '1',
      },
      { status: 'Stopped', ephemeral: false },
    );
    const result = await f.backend.createSession(specOf(ID));
    expect(result.resumed).toBe(false);
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
    expect(f.fake.instances.get(NAME)?.config[LABEL.created]).toBe(
      String(START_MS),
    );
  });
});

describe('a session that is already there', () => {
  test('a running one is a duplicate to adopt: nothing is touched', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.created]: '1',
    });
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error).toBeInstanceOf(SessionExistsError);
    expect(error.message).toContain(NAME);
    const writes = f.fake.requests.filter((r) => r.method !== 'GET');
    expect(writes).toEqual([]);
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
  });

  test('one still starting is a duplicate too', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(
      NAME,
      { [LABEL.sandboxSession]: '1', [LABEL.session]: ID },
      { status: 'Starting' },
    );
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error).toBeInstanceOf(SessionExistsError);
  });

  test('a standby claimed under another name counts: it is found by its label', async () => {
    const f = sessionFixture();
    f.fake.seedInstance('tale-sbx-pool-claimed', {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.created]: '1',
    });
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error).toBeInstanceOf(SessionExistsError);
    expect(f.fake.instances.size).toBe(1);
  });

  test('a peer that wins the name between the check and the create is a duplicate, and is left running', async () => {
    const f = sessionFixture();
    const release = f.fake.hold('POST /1.0/instances');
    const created = rejection(f.backend.createSession(specOf(ID)));
    // The create is at its POST; a peer's instance takes the name first.
    await Bun.sleep(20);
    f.fake.seedInstance(NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.created]: '7',
      [LABEL.createAttempt]: 'a-peer',
    });
    release();
    const error = await created;
    expect(error).toBeInstanceOf(SessionExistsError);
    expect(f.fake.instances.get(NAME)?.config[LABEL.createAttempt]).toBe(
      'a-peer',
    );
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
  });

  test('a name held by something that is not a session is a failure, not a duplicate', async () => {
    const f = sessionFixture();
    f.fake.seedInstance(NAME, {});
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error).not.toBeInstanceOf(SessionExistsError);
    expect(error.message).toContain('already exists');
    // Nothing that is not ours was removed.
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
  });
});

describe('a create that fails', () => {
  test('removes its own instance and keeps the workspace volume', async () => {
    const f = sessionFixture();
    f.runnerd.failFirst = 1_000_000;
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('runnerd did not become ready');
    expect(f.fake.instances.has(NAME)).toBe(false);
    // A workspace may already serve a retry or a peer: it stays.
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
  });

  test('takes the scratch volume of a render session with it', async () => {
    const f = sessionFixture();
    f.runnerd.failFirst = 1_000_000;
    await rejection(
      f.backend.createSession(specOf(ID, { profile: 'default' })),
    );
    expect(f.fake.instances.has(NAME)).toBe(false);
    expect(f.fake.volumes.has(VOLUME)).toBe(false);
  });

  test('says why when the instance stopped before runnerd answered, quoting its console', async () => {
    const f = sessionFixture();
    f.fake.onStarted = (instance) => {
      instance.consoleLog =
        'entrypoint: refusing to start: uid_map is host root';
    };
    // The first poll finds runnerd down, and the instance ends.
    let polls = 0;
    const crashing = new IncusSessionBackend(f.cfg, {
      runtime: f.runtime,
      runnerdHealth: async (opts, signal) => {
        polls += 1;
        if (polls === 1) {
          f.fake.instances.delete(NAME);
        }
        return f.runnerd.health(opts, signal);
      },
      runnerdEnvPatch: f.runnerd.envPatch,
    });
    const error = await rejection(crashing.createSession(specOf(ID)));
    expect(error.message).toContain('before runnerd became ready');
    expect(error.message).toContain('uid_map is host root');
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('says so when the instance is left stopped rather than gone', async () => {
    const f = sessionFixture();
    f.fake.onStarted = (instance) => {
      instance.consoleLog = 'entrypoint: killed';
    };
    let polls = 0;
    const stopping = new IncusSessionBackend(f.cfg, {
      runtime: f.runtime,
      runnerdHealth: async (opts, signal) => {
        polls += 1;
        const instance = f.fake.instances.get(NAME);
        if (polls === 1 && instance !== undefined) {
          instance.status = 'Stopped';
          instance.ephemeral = false;
          instance.bootEnv = undefined;
        }
        return f.runnerd.health(opts, signal);
      },
      runnerdEnvPatch: f.runnerd.envPatch,
    });
    const error = await rejection(stopping.createSession(specOf(ID)));
    expect(error.message).toContain('stopped before runnerd became ready');
    expect(error.message).toContain('entrypoint: killed');
    // The create's own cleanup took the debris away.
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('never removes an instance another create made, whatever failed', async () => {
    const f = sessionFixture();
    // The create's POST fails in a way that does not say the name is taken,
    // while a peer's instance sits under it.
    const release = f.fake.hold('POST /1.0/instances');
    f.fake.fail({
      match: 'POST /1.0/instances',
      status: 503,
      message: 'gateway timeout',
    });
    const created = rejection(f.backend.createSession(specOf(ID)));
    await Bun.sleep(20);
    f.fake.seedInstance(NAME, {
      [LABEL.sandboxSession]: '1',
      [LABEL.session]: ID,
      [LABEL.created]: '7',
      [LABEL.createAttempt]: 'a-peer',
    });
    release();
    const error = await created;
    expect(error.message).toContain('gateway timeout');
    expect(error).not.toBeInstanceOf(SessionExistsError);
    expect(f.fake.instances.get(NAME)?.status).toBe('Running');
    expect(f.fake.instances.get(NAME)?.config[LABEL.createAttempt]).toBe(
      'a-peer',
    );
  });

  test('fails the create when the seed env cannot be given, and removes the instance', async () => {
    const f = sessionFixture();
    f.runnerd.patchFailure = 'runnerd /env 500';
    const error = await rejection(
      f.backend.createSession(specOf(ID, { env: { A: 'b' } })),
    );
    expect(error.message).toContain('runnerd /env 500');
    expect(f.fake.instances.has(NAME)).toBe(false);
  });

  test('a create past the project’s memory cap fails with Incus’s words and removes nothing it should keep', async () => {
    const f = sessionFixture();
    // Room for one 4 GiB session.
    f.fake.projectConfig['limits.memory'] = '6GiB';
    await f.backend.createSession(specOf('first'));
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('Reached maximum aggregate value');
    expect(error.message).toContain('limits.memory');
    // The session that fit runs on; the one that did not left only its
    // workspace volume, for a retry.
    expect(f.fake.instances.has(incusInstanceName('first'))).toBe(true);
    expect(f.fake.instances.has(NAME)).toBe(false);
    expect(f.fake.volumes.has(VOLUME)).toBe(true);
  });

  test('every create is refused in a project that sets limits.cpu, as the boot check says', async () => {
    const f = sessionFixture();
    f.fake.projectConfig['limits.cpu'] = '64';
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('has no "limits.cpu" config');
    expect(f.fake.instances.size).toBe(0);
  });

  test('hears of a missing runtime image, and fails', async () => {
    const f = sessionFixture();
    f.fake.aliases.clear();
    const heard: string[] = [];
    f.backend.onRuntimeImageMissing((detail) => heard.push(detail));
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('Image not found');
    expect(heard).toHaveLength(1);
    expect(heard[0]).toContain('Image not found');
    expect(f.fake.instances.size).toBe(0);
  });

  test('stops at once for a caller that has already given up', async () => {
    const f = sessionFixture();
    const gone = AbortSignal.abort(new Error('caller gone'));
    const error = await rejection(
      f.backend.createSession(specOf(ID, { signal: gone })),
    );
    expect(error.message).toContain('caller gone');
    expect(f.fake.instances.size).toBe(0);
  });

  test('leaves the create under way counted against the capacity while it runs, and no longer after', async () => {
    const f = sessionFixture();
    const release = f.fake.hold('POST /1.0/instances');
    const created = f.backend.createSession(specOf(ID));
    await Bun.sleep(20);
    expect(f.runtime.inFlight.has(ID)).toBe(true);
    release();
    await created;
    expect(f.runtime.inFlight.has(ID)).toBe(false);

    const g = sessionFixture();
    g.runnerd.failFirst = 1_000_000;
    await rejection(g.backend.createSession(specOf(ID)));
    expect(g.runtime.inFlight.has(ID)).toBe(false);
  });

  test('a failed cleanup is logged, and the original failure is the one thrown', async () => {
    const f = sessionFixture();
    f.runnerd.failFirst = 1_000_000;
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
    const error = await rejection(f.backend.createSession(specOf(ID)));
    expect(error.message).toContain('runnerd did not become ready');
    expect(
      warn.mock.calls.some((call) =>
        String(call[0]).includes('failed-create cleanup skipped'),
      ),
    ).toBe(true);
  });
});
