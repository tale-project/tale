// Project limits and the spawner's own capacity, against the real node: a limit
// on the project is a server-side backstop that Incus enforces over every
// instance, and a create past it fails with Incus's own message, leaving the
// workspace volume for the retry or an explicit destroy; the spawner's
// SANDBOX_MAX_SESSIONS refuses first, with a place in the line.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

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
} from '../harness.ts';
import { field } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';
import { asText } from '../util.ts';

const report = reportFor('limits');
const spawner = spawnerOf({
  name: 'limits',
  port: 18009,
  token: newToken(),
  env: { SANDBOX_MAX_SESSIONS: '3' },
});
const api = spawner.api;
const ORG = 'e2e-limits';

describe('limits on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    await admin.unsetProject('limits.memory').catch((error: unknown) => {
      console.warn('limits.memory was not set:', error);
    });
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.unsetProject('limits.memory').catch((error: unknown) => {
      console.warn('limits.memory was not set:', error);
    });
    await admin.cleanSlate();
    report.flush();
  });

  step(
    'the spawner refuses past SANDBOX_MAX_SESSIONS, with a place in the line',
    async () => {
      const ids = [sessionId('cap'), sessionId('cap'), sessionId('cap')];
      for (const id of ids) {
        expectStatus(
          (
            await api.create({
              sessionId: id,
              organizationId: ORG,
              profile: 'agent-light',
            })
          ).reply,
          201,
          `create ${id}`,
        );
      }
      const capacity = await api.capacity(ORG);
      expect(field(capacity.json, 'sessions', 'running')).toBe(3);
      expect(field(capacity.json, 'sessions', 'limit')).toBe(3);
      const over = await api.create({
        sessionId: sessionId('over'),
        organizationId: ORG,
        profile: 'agent-light',
      });
      expectStatus(over.reply, 429, 'the fourth create');
      expect(field(over.reply.json, 'error')).toBe('session_quota');
      // The first one refused is first in the line: positions count from 0.
      expect(field(over.reply.json, 'queue', 'position')).toBe(0);
      expect(
        Number(over.reply.headers.get('retry-after')),
      ).toBeGreaterThanOrEqual(5);
      for (const id of ids)
        expectStatus(await api.destroy(id), 200, `destroy ${id}`);
    },
  );

  step(
    "a project memory limit refuses the create that would pass it, in Incus's words",
    async () => {
      // Two sessions' worth (4 GiB each) and a little over. The spawner says
      // so at boot: its capacity can add up to more than the project allows.
      // Incus refuses a limit below what the project already holds, so
      // whatever an earlier step left goes first.
      await admin.cleanSlate();
      await admin.setProject('limits.memory', '9GiB');
      expect(await spawner.stop()).not.toBeNull();
      spawner.start();
      await spawner.ready();
      expect(spawner.logTail(200)).toContain('limits.memory');
      const first = sessionId('lim');
      const second = sessionId('lim');
      const third = sessionId('lim');
      expectStatus(
        (
          await api.create({
            sessionId: first,
            organizationId: ORG,
            profile: 'agent-light',
          })
        ).reply,
        201,
        'first',
      );
      expectStatus(
        (
          await api.create({
            sessionId: second,
            organizationId: ORG,
            profile: 'agent-light',
          })
        ).reply,
        201,
        'second',
      );
      const refused = await api.create({
        sessionId: third,
        organizationId: ORG,
        profile: 'agent-light',
      });
      // A failed create, not a busy spawner: the platform must not queue it.
      expectStatus(refused.reply, 502, 'the create past the project limit');
      expect(field(refused.reply.json, 'error')).toBe('create_failed');
      expect(asText(field(refused.reply.json, 'message'))).toContain(
        'Reached maximum aggregate value',
      );
      // Only the workspace volume is left of it; the others are untouched.
      expect(await sessionInstance(third)).toBeUndefined();
      expect(await sessionVolume(third)).toBeDefined();
      expect(await sh(api, first, 'id -u')).toBe('10001\n');
      // An explicit destroy removes what the failed create left.
      expectStatus(await api.destroy(third), 200, 'destroy the failed session');
      expect(await sessionVolume(third)).toBeUndefined();
      // Room again once a session goes.
      expectStatus(await api.destroy(first), 200, 'destroy the first');
      expectStatus(
        (
          await api.create({
            sessionId: third,
            organizationId: ORG,
            profile: 'agent-light',
          })
        ).reply,
        201,
        'create after room',
      );
      expectStatus(await api.destroy(second), 200, 'destroy the second');
      expectStatus(await api.destroy(third), 200, 'destroy the third');
      await admin.unsetProject('limits.memory');
    },
  );
});
