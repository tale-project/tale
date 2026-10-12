// The objects in Incus are the source of truth and the spawner's registry a
// cache: a spawner that crashes or restarts re-adopts its sessions from their
// labels, compute that ended while it was away is removed with the workspace
// kept, a peer that replaced a session under its name is never undone by a
// spawner still holding the old incarnation, and a peer that lists the
// project while a create is under way does not take it for compute that ended.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import {
  isWarmupInstanceName,
  LABEL,
  label,
} from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  pause,
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

const report = reportFor('adoption');
const token = newToken();
const a = spawnerOf({ name: 'adopt-a', port: 18020, token });
const b = spawnerOf({ name: 'adopt-b', port: 18021, token });
const ORG = 'e2e-adopt';
const MIN_PEER_BOOTS = 12;

const ADOPTED = sessionId('adopt');
const REBOOTED = sessionId('reboot');
const FENCED = sessionId('fence');

let adoptedStamp = 0;

describe('re-adoption and fencing on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    a.start();
    await a.ready({ image: true });
  }, 40 * 60_000);

  afterAll(async () => {
    await b.stop();
    await a.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('a session with a pin, a file and an env patch', async () => {
    const created = await a.api.create({
      sessionId: ADOPTED,
      organizationId: ORG,
      profile: 'agent',
      env: { SEEDED: 'at-create' },
    });
    expectStatus(created.reply, 201, 'create');
    adoptedStamp = created.session?.createdAtMs ?? 0;
    expectStatus(await a.api.pin(ADOPTED, true), 200, 'pin');
    expectStatus(
      await a.api.patchEnv(ADOPTED, { set: { PATCHED: 'later' } }),
      200,
      'env',
    );
    await sh(a.api, ADOPTED, 'echo before > /agent/marker');
    expect(await sh(a.api, ADOPTED, 'printenv SEEDED PATCHED')).toBe(
      'at-create\nlater\n',
    );
  });

  step('a crashed spawner leaves the session running', async () => {
    await a.kill();
    const instance = await sessionInstance(ADOPTED);
    expect(instance?.status).toBe('Running');
  });

  step(
    'a new spawner re-adopts it from the labels, pin and incarnation included',
    async () => {
      const started = performance.now();
      a.start();
      await a.ready();
      report.add(
        'restart after a crash: boot to ready, one session to adopt',
        performance.now() - started,
      );
      const reply = await a.api.get(ADOPTED);
      expectStatus(reply, 200, 'GET the adopted session');
      expect(field(reply.json, 'session', 'pinned')).toBe(true);
      expect(field(reply.json, 'session', 'createdAtMs')).toBe(adoptedStamp);
      expect(await sh(a.api, ADOPTED, 'cat /agent/marker')).toBe('before\n');
      // runnerd kept its env store: the spawner never held it.
      expect(await sh(a.api, ADOPTED, 'printenv SEEDED PATCHED')).toBe(
        'at-create\nlater\n',
      );
      const capacity = await a.api.capacity(ORG);
      expect(field(capacity.json, 'sessions', 'running')).toBe(1);
      // And it is the same instance: nothing was made again.
      expect(
        label((await sessionInstance(ADOPTED))?.config ?? {}, LABEL.created),
      ).toBe(String(adoptedStamp));
    },
  );

  step('a graceful restart does the same', async () => {
    expect(await a.stop()).not.toBeNull();
    a.start();
    await a.ready();
    expectStatus(await a.api.get(ADOPTED), 200, 'GET after a graceful restart');
    expect(await sh(a.api, ADOPTED, 'cat /agent/marker')).toBe('before\n');
    expectStatus(await a.api.destroy(ADOPTED), 200, 'destroy');
  });

  step(
    'compute that ended while the spawner was away is removed, the workspace kept',
    async () => {
      expectStatus(
        (
          await a.api.create({
            sessionId: REBOOTED,
            organizationId: ORG,
            profile: 'agent',
          })
        ).reply,
        201,
        'create',
      );
      await sh(a.api, REBOOTED, 'echo survives > /agent/marker');
      // A node reboot leaves stopped instances behind; so does this.
      await a.stop();
      const instance = await sessionInstance(REBOOTED);
      if (instance === undefined)
        throw new Error('the session vanished with the spawner');
      await admin.run([
        'stop',
        instance.name,
        '--project',
        admin.lab.project,
        '--force',
      ]);
      a.start();
      await a.ready();
      await until(
        'the ended instance to be removed after adoption',
        async () =>
          (await sessionInstance(REBOOTED)) === undefined || undefined,
        { timeoutMs: 6 * 60_000, intervalMs: 2_000 },
      );
      expect(await sessionVolume(REBOOTED)).toBeDefined();
      expect((await a.api.get(REBOOTED)).status).toBe(404);
      // The platform resumes it, and the file is there.
      expectStatus(
        (
          await a.api.create({
            sessionId: REBOOTED,
            organizationId: ORG,
            profile: 'agent',
          })
        ).reply,
        201,
        'resume',
      );
      expect(await sh(a.api, REBOOTED, 'cat /agent/marker')).toBe('survives\n');
      expectStatus(await a.api.destroy(REBOOTED), 200, 'destroy');
    },
  );

  step(
    'a peer that replaced a session under its name is not undone by the old holder',
    async () => {
      const first = await a.api.create({
        sessionId: FENCED,
        organizationId: ORG,
        profile: 'agent',
        ttlMs: 30_000,
      });
      expectStatus(first.reply, 201, 'create on the first spawner');
      const staleStamp = first.session?.createdAtMs ?? 0;

      // A rollout's overlap: a second spawner, the same token, the same project.
      b.start();
      await b.ready();
      const adopted = await b.api.get(FENCED);
      expectStatus(adopted, 200, 'the peer adopts the session at boot');
      expect(field(adopted.json, 'session', 'createdAtMs')).toBe(staleStamp);
      // A duplicate is a duplicate whichever spawner is asked.
      const duplicate = await b.api.create({
        sessionId: FENCED,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(
        duplicate.reply,
        409,
        'a create of a live session on the peer',
      );

      // The peer replaces it: destroyed, created again under the same name.
      expectStatus(await b.api.destroy(FENCED), 200, 'the peer destroys');
      const second = await b.api.create({
        sessionId: FENCED,
        organizationId: ORG,
        profile: 'agent',
        ttlMs: 3_600_000,
      });
      expectStatus(second.reply, 201, 'the peer creates it again');
      const freshStamp = second.session?.createdAtMs ?? 0;
      expect(freshStamp).not.toBe(staleStamp);
      await sh(b.api, FENCED, 'echo replacement > /agent/marker');

      // The first spawner still holds the old incarnation, whose lifetime (30 s)
      // is long past. Its sweeps must not touch what lives under the name now.
      await pause(150_000);
      const instance = await sessionInstance(FENCED);
      expect(instance?.status).toBe('Running');
      expect(label(instance?.config ?? {}, LABEL.created)).toBe(
        String(freshStamp),
      );
      expect(await sh(b.api, FENCED, 'cat /agent/marker')).toBe(
        'replacement\n',
      );
      // The first spawner's own sweeps registered the replacement within an
      // interval (a peer's create is adopted like any), so what it answers for
      // the id now is the new incarnation, not the one it created.
      const known = await a.api.get(FENCED);
      expectStatus(known, 200, 'the first spawner asked for the id');
      expect(field(known.json, 'session', 'createdAtMs')).toBe(freshStamp);
      expect((await sessionInstance(FENCED))?.status).toBe('Running');
      expectStatus(await b.api.destroy(FENCED), 200, 'destroy');
    },
  );
  step(
    'a peer that boots again and again never reaps a create in flight',
    async () => {
      // An instance is stopped between its creation and its start, and a
      // spawner that boots lists the project and adopts what it finds: if it
      // read that moment as compute that ended it would delete a create under
      // way. A rollout overlaps two spawners; here the peer boots a dozen
      // times while the first spawner makes sessions five at a time.
      await b.stop();
      const failures: string[] = [];
      const progress = { creating: true };
      const bursts = (async () => {
        try {
          for (let round = 1; round <= 4; round += 1) {
            const ids = Array.from({ length: 5 }, () => sessionId('peer'));
            const results = await Promise.all(
              ids.map((id) =>
                a.api.create({
                  sessionId: id,
                  organizationId: ORG,
                  profile: 'agent-light',
                }),
              ),
            );
            for (const [index, result] of results.entries()) {
              if (result.reply.status !== 201) {
                failures.push(
                  `round ${round}: ${ids[index]} answered HTTP ${result.reply.status}: ${result.reply.text.slice(0, 240)}`,
                );
              }
            }
            await Promise.all(ids.map((id) => a.api.destroy(id)));
          }
        } finally {
          progress.creating = false;
        }
      })();
      let boots = 0;
      const peers = (async () => {
        // At least a dozen boots, and as many as the creates take; no more
        // than a few hundred, whatever happens to them.
        while (boots < MIN_PEER_BOOTS || (progress.creating && boots < 300)) {
          // No image warm-up: this boot is about adopting and sweeping, and a
          // peer killed seconds after it starts would leave the throwaway
          // instance of its warm-up (and its create operation) behind.
          b.start({ SANDBOX_SKIP_IMAGE_WARMUP: '1' });
          await b.ready();
          await b.stop();
          boots += 1;
        }
      })();
      await Promise.all([bursts, peers]);
      report.fact(
        'boots of the peer while the sessions were made',
        String(boots),
      );
      expect(failures).toEqual([]);
      // Every create was answered and destroyed, and no session is left behind
      // (the throwaway instance of a spawner's own image warm-up, which
      // removes it itself, is not one).
      expect(
        (await admin.instances())
          .map((instance) => instance.name)
          .filter((name) => !isWarmupInstanceName(name)),
      ).toEqual([]);
    },
    15 * 60_000,
  );
});
