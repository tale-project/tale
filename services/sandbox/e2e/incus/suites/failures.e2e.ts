// Endings that are not a clean destroy, against the real node: a session whose
// process ends by itself stays stopped with its console readable and resumes on
// the next create; a busy session stopped by a draining spawner is asked to
// shut down first, and the exec it was running hears it; and a create whose
// image cannot start a session fails with the reason in its message, leaving
// the workspace for a retry.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  lab,
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
import { asText } from '../util.ts';

const report = reportFor('failures');
const token = newToken();
const spawner = spawnerOf({
  name: 'failures',
  port: 18040,
  token,
  env: {
    SANDBOX_SESSION_MAX_LINGER_MS: '60000',
    SANDBOX_SESSION_CREATE_TIMEOUT_MS: '30000',
  },
});
const api = spawner.api;
const ORG = 'e2e-failures';
/** The egress image, imported under another alias: an image whose entrypoint
 * starts a proxy where a session expects runnerd. */
const NOT_A_RUNTIME = 'e2e-not-a-runtime';

const ENDED = sessionId('ended');
const GRACE = sessionId('grace');
const BROKEN = sessionId('broken');

// Ends runnerd, the only child of the container's init.
const KILL_RUNNERD = `for p in /proc/[0-9]*; do
  if tr '\\0' ' ' < "$p/cmdline" 2>/dev/null | grep -q 'node.*[r]unnerd'; then kill -9 "\${p#/proc/}"; fi
done`;

describe('endings that are not a clean destroy', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    await admin.run([
      'image',
      'copy',
      `local:${lab.egressImage}`,
      'local:',
      '--alias',
      NOT_A_RUNTIME,
      '--project',
      'default',
      '--target-project',
      lab.project,
    ]);
    spawner.start();
    await spawner.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    await admin.run(
      ['image', 'delete', NOT_A_RUNTIME, '--project', lab.project],
      {
        allowFailure: true,
      },
    );
    report.flush();
  });

  step(
    'a session whose process ends by itself stays stopped, console readable',
    async () => {
      expectStatus(
        (
          await api.create({
            sessionId: ENDED,
            organizationId: ORG,
            profile: 'agent',
          })
        ).reply,
        201,
        'create',
      );
      await sh(api, ENDED, 'echo survives > /agent/marker');
      const instance = await sessionInstance(ENDED);
      if (instance === undefined) throw new Error('no instance');
      await admin.exec(instance.name, ['sh', '-c', KILL_RUNNERD], {
        allowFailure: true,
      });
      await until(
        'the instance to stop',
        async () =>
          (await admin.instance(instance.name))?.status === 'Stopped' ||
          undefined,
        { timeoutMs: 60_000, intervalMs: 1_000 },
      );
      // Not ephemeral: the instance stays, and so does what it said.
      const console = await admin.consoleLog(instance.name);
      report.fact(
        'console of an ended session',
        console.trim().split('\n').slice(-3).join(' | ').slice(0, 300),
      );
      expect(console).toContain('/dev/shm is a tmpfs');
      // The spawner knows it is gone.
      await until(
        'the spawner to see it gone',
        async () => (await api.get(ENDED)).status === 404 || undefined,
        { timeoutMs: 120_000, intervalMs: 2_000 },
      );
    },
  );

  step(
    'the next create of the id removes the stopped instance and resumes the workspace',
    async () => {
      const resumed = await api.create({
        sessionId: ENDED,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(resumed.reply, 201, 'create over an ended session');
      expect(await sh(api, ENDED, 'cat /agent/marker')).toBe('survives\n');
      const all = (await admin.instances()).filter(
        (i) => label(i.config, LABEL.session) === ENDED,
      );
      expect(all).toHaveLength(1);
      expect(all[0]?.status).toBe('Running');
      expectStatus(await api.destroy(ENDED), 200, 'destroy');
    },
  );

  step(
    'a busy session stopped by a draining spawner hears the shutdown',
    async () => {
      expectStatus(
        (
          await api.create({
            sessionId: GRACE,
            organizationId: ORG,
            profile: 'agent',
          })
        ).reply,
        201,
        'create',
      );
      let running = false;
      const exec = api.exec(GRACE, {
        execId: 'grace-run',
        // `wait` returns the moment the signal comes, where a trap would sit
        // out the rest of a foreground `sleep` and Incus's init, which ends
        // the container a second after it passes the signal on, would not.
        shell:
          "trap 'echo graceful > /agent/graceful-marker; exit 0' TERM; echo ready; while :; do sleep 1 & wait $!; done",
        timeoutMs: 600_000,
        onEvent: (event) => {
          if (event.event === 'stdout') running = true;
        },
      });
      await until('the exec to run', () => running || undefined, {
        timeoutMs: 30_000,
        intervalMs: 250,
      });
      const started = performance.now();
      expectStatus(await api.drain(), 200, 'drain');
      // The linger is a minute, and the sweep that notices it runs every minute.
      await until(
        'the linger reap to stop the busy session',
        async () => (await sessionInstance(GRACE)) === undefined || undefined,
        { timeoutMs: 6 * 60_000, intervalMs: 2_000 },
      );
      report.add(
        'drain to the linger reap of a busy session',
        performance.now() - started,
        'linger 60 s, sweep every 60 s',
      );
      await exec.catch((error: unknown) => {
        console.warn('the stopped exec ended with:', error);
      });
      expect(await sessionVolume(GRACE)).toBeDefined();

      // A fresh spawner (this one is draining): resume, and read what the exec
      // wrote when it heard the shutdown.
      expect(await spawner.stop()).not.toBeNull();
      spawner.start();
      await spawner.ready();
      expectStatus(
        (
          await api.create({
            sessionId: GRACE,
            organizationId: ORG,
            profile: 'agent',
          })
        ).reply,
        201,
        'resume',
      );
      expect(await sh(api, GRACE, 'cat /agent/graceful-marker')).toBe(
        'graceful\n',
      );
      expectStatus(await api.destroy(GRACE), 200, 'destroy');
    },
  );

  step(
    'an image that cannot start a session fails the create and keeps the workspace',
    async () => {
      expect(await spawner.stop()).not.toBeNull();
      spawner.start({
        SANDBOX_INCUS_IMAGE: NOT_A_RUNTIME,
        SANDBOX_INCUS_IMAGE_SOURCE: undefined,
      });
      await spawner.ready({ image: true });
      const started = performance.now();
      const failed = await api.create({
        sessionId: BROKEN,
        organizationId: ORG,
        profile: 'agent',
      });
      report.add(
        'a create that never becomes ready fails after its budget',
        performance.now() - started,
        'budget 30 s',
      );
      expectStatus(failed.reply, 502, 'create with a broken image');
      expect(field(failed.reply.json, 'error')).toBe('create_failed');
      const message = asText(field(failed.reply.json, 'message'));
      report.fact('the failure a platform reads', message.slice(0, 300));
      // The answer says why, so nobody needs the node to know: the instance
      // stopped, or never answered. (It quotes the end of the instance's
      // console when the image printed any; this image prints nothing, and the
      // unit tests of the backend own the quote.)
      expect(message).toMatch(
        /stopped before runnerd became ready|did not become ready/,
      );
      // The failed create removed its instance and kept the durable workspace.
      expect(await sessionInstance(BROKEN)).toBeUndefined();
      expect(await sessionVolume(BROKEN)).toBeDefined();
      expectStatus(
        await api.destroy(BROKEN),
        200,
        'destroy the failed session',
      );
      expect(await sessionVolume(BROKEN)).toBeUndefined();
    },
  );
});
