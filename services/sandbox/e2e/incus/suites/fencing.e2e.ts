// The fence and the ETag, against the real Incus API, without a spawner in the
// way. The unit tests prove the backend's logic against an imitation; this
// proves the two things the imitation assumes of Incus:
//
//  - a PATCH carrying If-Match is refused (412) when the instance changed since
//    the ETag was read, which is what makes a warm-pool claim and a pin land on
//    one incarnation only;
//  - the backend's fenced operations (given the creation stamp they expect)
//    refuse a different incarnation under the same name and touch nothing.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { IncusApiError } from '../../../src/backend/incus/incus-api.ts';
import { IncusClient } from '../../../src/backend/incus/incus-client.ts';
import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import { readIncusTlsMaterial } from '../../../src/backend/incus/incus-tls.ts';
import { loadBackends } from '../../../src/backend/index.ts';
import {
  SessionExistsError,
  SessionIncarnationChangedError,
  type SessionBackend,
} from '../../../src/backend/types.ts';
import { loadConfig } from '../../../src/config.ts';
import {
  admin,
  lab,
  reportFor,
  sessionId,
  sessionInstance,
  sessionVolume,
  step,
  until,
} from '../harness.ts';
import { newToken, spawnerEnv } from '../spawner.ts';

const report = reportFor('fencing');
const ORG = 'e2e-fencing';
const PROBE = 'e2e-etag-probe';

let client: IncusClient;
let backend: SessionBackend;

/** What a promise was rejected with; undefined when it was not. */
function failure(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error,
  );
}

/** loadConfig reads the process environment: give it the spawner's, once. */
function configOfASpawner() {
  const env = spawnerEnv(
    lab,
    { name: 'fencing', port: 18050, token: newToken() },
    '/tmp',
  );
  const saved: Record<string, string | undefined> = {};
  for (const [key, value] of Object.entries(env)) {
    if (key.startsWith('SANDBOX_') || key.startsWith('TALE_')) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
  }
  try {
    return loadConfig();
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

describe('the fence and the ETag on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    client = new IncusClient({
      endpoint: lab.endpoint,
      project: lab.project,
      tls: await readIncusTlsMaterial({
        clientCertFile: lab.clientCertFile,
        clientKeyFile: lab.clientKeyFile,
        serverCertFile: lab.serverCertFile,
      }),
    });
    // Suites run alone find no image yet: pull it as the spawner does.
    if ((await client.getImageAlias(lab.image)) === undefined) {
      const reference = lab.imageSource;
      const slash = reference.indexOf('/');
      await client.pullOciImage(
        {
          server: `https://${reference.slice(0, slash)}`,
          alias: reference.slice(slash + 1),
        },
        lab.image,
        20 * 60_000,
      );
    }
    const cfg = configOfASpawner();
    backend = (await loadBackends(cfg)).createSession();
  }, 40 * 60_000);

  afterAll(async () => {
    await admin.run(['delete', PROBE, '--project', lab.project, '--force'], {
      allowFailure: true,
    });
    await admin.cleanSlate();
    report.flush();
  });

  step(
    'a write carrying a stale ETag is refused with 412, a fresh one lands',
    async () => {
      await client.createInstance(
        {
          name: PROBE,
          ephemeral: false,
          profiles: [lab.profile],
          config: { 'limits.memory': '256MiB', 'limits.processes': '64' },
          devices: {},
          source: { type: 'image', alias: lab.image },
          start: false,
        },
        5 * 60_000,
      );
      const first = await client.getInstance(PROBE);
      expect(first?.etag).toBeDefined();
      await client.patchInstance(
        PROBE,
        { config: { 'user.e2e.first': '1' } },
        { ifMatch: first?.etag ?? '' },
      );
      // The instance changed: the ETag read before is no longer its own.
      const stale = await client
        .patchInstance(
          PROBE,
          { config: { 'user.e2e.stale': '1' } },
          { ifMatch: first?.etag ?? '' },
        )
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(stale).toBeInstanceOf(IncusApiError);
      expect(stale instanceof IncusApiError ? stale.status : 0).toBe(412);
      const second = await client.getInstance(PROBE);
      expect(second?.etag).not.toBe(first?.etag);
      await client.patchInstance(
        PROBE,
        { config: { 'user.e2e.second': '2' } },
        { ifMatch: second?.etag ?? '' },
      );
      const config = (await client.getInstance(PROBE))?.instance.config ?? {};
      expect(config['user.e2e.first']).toBe('1');
      expect(config['user.e2e.second']).toBe('2');
      expect(config['user.e2e.stale']).toBeUndefined();
      await client.deleteInstance(PROBE, 60_000);
    },
  );

  const ID = sessionId('fence');
  let stamp = 0;

  step(
    'a session is created by the backend alone, and a second create of it is a duplicate',
    async () => {
      stamp = Date.now();
      const started = performance.now();
      const created = await backend.createSession({
        sessionId: ID,
        organizationId: ORG,
        profile: 'agent',
        ttlMs: 3_600_000,
        idleTimeoutMs: 1_800_000,
        env: {},
        createdAtMs: stamp,
      });
      report.add(
        'createSession through the backend, in process',
        performance.now() - started,
      );
      expect(created.resumed).toBe(false);
      const duplicate = await backend
        .createSession({
          sessionId: ID,
          organizationId: ORG,
          profile: 'agent',
          ttlMs: 3_600_000,
          idleTimeoutMs: 1_800_000,
          env: {},
          createdAtMs: stamp + 1,
        })
        .then(
          () => undefined,
          (error: unknown) => error,
        );
      expect(duplicate).toBeInstanceOf(SessionExistsError);
      // Nothing was touched by the refused create.
      const instance = await sessionInstance(ID);
      expect(instance?.status).toBe('Running');
      expect(label(instance?.config ?? {}, LABEL.created)).toBe(String(stamp));
    },
  );

  step(
    'a different incarnation is not the session: exists says no, the rest refuse',
    async () => {
      expect(await backend.sessionExists(ID, stamp)).toBe(true);
      expect(await backend.sessionExists(ID, stamp + 1)).toBe(false);
      const wrong = stamp + 1;
      expect(await failure(backend.resolveEndpoint(ID, wrong))).toBeInstanceOf(
        SessionIncarnationChangedError,
      );
      expect(await failure(backend.stopSession(ID, wrong))).toBeInstanceOf(
        SessionIncarnationChangedError,
      );
      expect(await failure(backend.setPinned(ID, true, wrong))).toBeInstanceOf(
        SessionIncarnationChangedError,
      );
      // All of it left the real incarnation alone.
      const instance = await sessionInstance(ID);
      expect(instance?.status).toBe('Running');
      expect(label(instance?.config ?? {}, LABEL.pinned)).toBeUndefined();
      expect(await backend.resolveEndpoint(ID, stamp)).toMatch(
        /^http:\/\/10\.20\.0\.[0-9]+:8200$/,
      );
    },
  );

  step(
    'the right stamp pins, lists and stops; the workspace stays for the resume',
    async () => {
      await backend.setPinned(ID, true, stamp);
      const listed = (await backend.listSessions()).find(
        (s) => s.sessionId === ID,
      );
      expect(listed).toMatchObject({
        sessionId: ID,
        organizationId: ORG,
        profile: 'agent',
        createdAtMs: stamp,
        pinned: true,
      });
      await backend.setPinned(ID, false, stamp);
      await backend.stopSession(ID, stamp);
      await until(
        'the instance to be gone',
        async () => (await sessionInstance(ID)) === undefined || undefined,
        { timeoutMs: 60_000 },
      );
      expect(await sessionVolume(ID)).toBeDefined();
      // A resume is a create over the kept workspace.
      const resumed = await backend.createSession({
        sessionId: ID,
        organizationId: ORG,
        profile: 'agent',
        ttlMs: 3_600_000,
        idleTimeoutMs: 1_800_000,
        env: {},
        createdAtMs: stamp + 10,
      });
      expect(resumed.resumed).toBe(true);
      expect(await backend.sessionExists(ID, stamp)).toBe(false);
      expect(await backend.sessionExists(ID, stamp + 10)).toBe(true);
    },
  );

  step('destroy removes everything and says the bytes are gone', async () => {
    expect(await backend.destroySession(ID)).toBe(true);
    expect(await sessionInstance(ID)).toBeUndefined();
    expect(await sessionVolume(ID)).toBeUndefined();
    expect(await backend.workspaceDeletion(ID, 10_000)).toBe('done');
    expect(await backend.destroySession(ID)).toBe(false);
  });
});
