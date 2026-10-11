// The reaper, against the real node: a session past its lifetime and an idle
// one are stopped by the sweep (the compute goes, the workspace stays and the
// next create resumes it), and a pinned one is left alone however old or idle
// it gets. The sweep runs every minute, so the lifetimes here are seconds and
// the waits are minutes.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  reportFor,
  sessionId,
  sessionInstance,
  sessionVolume,
  sh,
  spawnerOf,
  step,
  until,
} from '../harness.ts';
import { field } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';

const report = reportFor('reaping');
const spawner = spawnerOf({ name: 'reaping', port: 18008, token: newToken() });
const api = spawner.api;
const ORG = 'e2e-reap';

const EXPIRING = sessionId('ttl');
const IDLE = sessionId('idle');
const PINNED = sessionId('pinned');
const LIFETIME_MS = 20_000;

let createdAt = 0;

describe('the reaper on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('create three sessions: short-lived, idle, and pinned', async () => {
    const options = { organizationId: ORG, profile: 'agent' as const };
    const first = await api.create({
      ...options,
      sessionId: EXPIRING,
      ttlMs: LIFETIME_MS,
      idleTimeoutMs: 3_600_000,
    });
    expectStatus(first.reply, 201, 'create the short-lived session');
    createdAt = performance.now();
    expectStatus(
      (
        await api.create({
          ...options,
          sessionId: IDLE,
          ttlMs: 3_600_000,
          idleTimeoutMs: LIFETIME_MS,
        })
      ).reply,
      201,
      'create the idle session',
    );
    expectStatus(
      (
        await api.create({
          ...options,
          sessionId: PINNED,
          ttlMs: LIFETIME_MS,
          idleTimeoutMs: LIFETIME_MS,
        })
      ).reply,
      201,
      'create the pinned session',
    );
    expectStatus(await api.pin(PINNED, true), 200, 'pin');
    for (const id of [EXPIRING, IDLE, PINNED]) {
      await sh(
        api,
        id,
        'mkdir -p /agent/keep && echo kept > /agent/keep/marker',
      );
    }
  });

  step(
    'a session past its lifetime is stopped by the sweep, its workspace kept',
    async () => {
      await until(
        'the sweep to stop the expired session',
        async () =>
          (await sessionInstance(EXPIRING)) === undefined || undefined,
        { timeoutMs: 6 * 60_000, intervalMs: 2_000 },
      );
      report.add(
        `stopped by the sweep once its lifetime (${LIFETIME_MS / 1000} s) passed`,
        performance.now() - createdAt,
        'sweep every 60 s',
      );
      expect(await sessionVolume(EXPIRING)).toBeDefined();
      expect((await api.get(EXPIRING)).status).toBe(404);
    },
  );

  step(
    'an idle session is stopped by the sweep, its workspace kept',
    async () => {
      await until(
        'the sweep to stop the idle session',
        async () => (await sessionInstance(IDLE)) === undefined || undefined,
        { timeoutMs: 6 * 60_000, intervalMs: 2_000 },
      );
      report.add(
        `stopped by the sweep once idle for ${LIFETIME_MS / 1000} s`,
        performance.now() - createdAt,
        'sweep every 60 s',
      );
      expect(await sessionVolume(IDLE)).toBeDefined();
      expect((await api.get(IDLE)).status).toBe(404);
    },
  );

  step('a pinned session outlives its lifetime and its idle time', async () => {
    // Two sweeps have run since it expired; it is still there and still works.
    const instance = await sessionInstance(PINNED);
    expect(instance?.status).toBe('Running');
    expect(label(instance?.config ?? {}, LABEL.pinned)).toBe('true');
    expect(field((await api.get(PINNED)).json, 'session', 'pinned')).toBe(true);
    expect(await sh(api, PINNED, 'cat /agent/keep/marker')).toBe('kept\n');
  });

  step('the stopped sessions resume with their files', async () => {
    for (const id of [EXPIRING, IDLE]) {
      const resumed = await api.create({
        sessionId: id,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(resumed.reply, 201, `resume ${id}`);
      expect(await sh(api, id, 'cat /agent/keep/marker')).toBe('kept\n');
      expectStatus(await api.destroy(id), 200, `destroy ${id}`);
    }
  });

  step(
    'unpinned and destroyed, the pinned session goes with its workspace',
    async () => {
      expectStatus(await api.pin(PINNED, false), 200, 'unpin');
      expectStatus(await api.destroy(PINNED), 200, 'destroy');
      expect(await sessionInstance(PINNED)).toBeUndefined();
      expect(await sessionVolume(PINNED)).toBeUndefined();
    },
  );
});
