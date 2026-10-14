// Upgrading the runtime image, against the real node: the event of every Tale
// release. The operator gives the new version a new alias and restarts the
// spawner (docs/incus.md, "Image"); the spawner pulls the new image from the
// registry under that alias, unpacks it, and from then on makes sessions and
// standbys from it. A session that runs keeps running on the version it
// started with, and the spawner adopts it all the same. The "next version" is
// the current image and one file more (lab.sh `next-context`, built by the
// workflow), so Incus sees another image and the rest is the same.

import { afterAll, beforeAll, describe, expect } from 'bun:test';

import { LABEL, label } from '../../../src/backend/incus/incus-naming.ts';
import {
  admin,
  expectStatus,
  lab,
  readyStandbys,
  reportFor,
  sessionId,
  sessionInstance,
  sh,
  spawnerOf,
  standbys,
  step,
  until,
} from '../harness.ts';
import { field } from '../spawner-api.ts';
import { newToken } from '../spawner.ts';

const report = reportFor('upgrade');
const spawner = spawnerOf({
  name: 'upgrade',
  port: 18060,
  token: newToken(),
  env: { SANDBOX_INCUS_POOL_SIZE: '2', SANDBOX_MAX_SESSIONS: '6' },
});
const api = spawner.api;
const ORG = 'e2e-upgrade';
const NEXT_ALIAS = `${lab.image}-next`;
const OLD = sessionId('old');
const NEW = sessionId('new');
const COLD = sessionId('cold');

let before = '';
let after = '';

/** The fingerprint an image alias of the project points at. */
async function aliasTarget(alias: string): Promise<string | undefined> {
  const raw = await admin.queryOptional(
    `/1.0/images/aliases/${encodeURIComponent(alias)}?project=${lab.project}`,
  );
  const target = field(raw, 'target');
  return typeof target === 'string' ? target : undefined;
}

/** The image an instance was made from. */
async function baseImage(name: string): Promise<string | undefined> {
  const raw = (await admin.instance(name))?.config['volatile.base_image'];
  return raw === '' ? undefined : raw;
}

/** The version file the next image carries; absent from the current one. */
async function version(id: string): Promise<string> {
  const outcome = await api.exec(id, {
    shell: 'cat /usr/share/tale-e2e-version 2>/dev/null || echo none',
  });
  return outcome.stdout.trim();
}

describe('upgrading the runtime image on a real node', () => {
  beforeAll(async () => {
    await admin.cleanSlate();
    spawner.start();
    await spawner.ready({ image: true });
    const target = await aliasTarget(lab.image);
    if (target === undefined) throw new Error(`no image alias ${lab.image}`);
    before = target;
  }, 40 * 60_000);

  afterAll(async () => {
    await spawner.stop();
    await admin.cleanSlate();
    report.flush();
  });

  step('the next version is in the registry', async () => {
    const match = /^([^/]+)\/(.+):([^:/]+)$/.exec(lab.imageSourceNext);
    if (match === null)
      throw new Error(`cannot read ${lab.imageSourceNext} as host/name:tag`);
    const [, host, name, tag] = match;
    const reply = await fetch(`http://${host}/v2/${name}/manifests/${tag}`, {
      method: 'HEAD',
      headers: {
        accept:
          'application/vnd.oci.image.index.v1+json, application/vnd.oci.image.manifest.v1+json',
      },
    });
    // The workflow builds it (lab.sh next-context); a hand run builds it too.
    expect(reply.status, `${lab.imageSourceNext} is not in the registry`).toBe(
      200,
    );
  });

  step(
    'a session and a full pool run the current version',
    async () => {
      await until(
        'the pool to fill',
        async () => (await readyStandbys()).length === 2,
        { timeoutMs: 5 * 60_000, intervalMs: 1_000 },
      );
      const created = await api.create({
        sessionId: OLD,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(created.reply, 201, 'create on the current version');
      await sh(api, OLD, 'echo before > /agent/marker');
      const instance = await sessionInstance(OLD);
      expect(await baseImage(instance?.name ?? '')).toBe(before);
      expect(await version(OLD)).toBe('none');
    },
    10 * 60_000,
  );

  step(
    'an alias that exists is never pulled again, whatever source the spawner is given',
    async () => {
      expect(await spawner.stop()).not.toBeNull();
      spawner.start({ SANDBOX_INCUS_IMAGE_SOURCE: lab.imageSourceNext });
      await spawner.ready({ image: true });
      expect(spawner.logTail(200)).not.toContain('pulling');
      expect(await aliasTarget(lab.image)).toBe(before);
      // The session it adopted is the old one, on the old version.
      expect((await api.get(OLD)).status).toBe(200);
    },
  );

  step(
    'the next version is pulled under its own alias, and the session on the old one is adopted',
    async () => {
      expect(await spawner.stop()).not.toBeNull();
      const started = performance.now();
      spawner.start({
        SANDBOX_INCUS_IMAGE: NEXT_ALIAS,
        SANDBOX_INCUS_IMAGE_SOURCE: lab.imageSourceNext,
      });
      await spawner.ready({ image: true });
      report.add(
        'restart on the next version: pull, unpack, ready',
        performance.now() - started,
      );
      expect(spawner.logTail(200)).toContain('pulling');
      const next = await aliasTarget(NEXT_ALIAS);
      if (next === undefined) throw new Error(`no image alias ${NEXT_ALIAS}`);
      after = next;
      expect(after).not.toBe(before);
      // The old alias is as it was: images are never replaced in place.
      expect(await aliasTarget(lab.image)).toBe(before);

      // The session that runs is adopted, still on the version it started on.
      const adopted = await api.get(OLD);
      expectStatus(adopted, 200, 'GET the session across the upgrade');
      expect(await sh(api, OLD, 'cat /agent/marker')).toBe('before\n');
      const instance = await sessionInstance(OLD);
      expect(await baseImage(instance?.name ?? '')).toBe(before);
      expect(await version(OLD)).toBe('none');
    },
    15 * 60_000,
  );

  step('the pool rotates to the next version', async () => {
    const started = performance.now();
    await until(
      'standbys of the next version only',
      async () => {
        const waiting = await readyStandbys();
        const all = await standbys();
        return (
          waiting.length === 2 &&
          all.length === 2 &&
          all.every(
            (standby) => label(standby.config, LABEL.poolImage) === after,
          )
        );
      },
      { timeoutMs: 5 * 60_000, intervalMs: 2_000 },
    );
    report.add(
      'the pool follows the next version (old standbys out, new ones waiting)',
      performance.now() - started,
    );
    for (const standby of await standbys()) {
      expect(await baseImage(standby.name)).toBe(after);
    }
  });

  step(
    'new sessions, claimed and cold, run the next version; the old one is left alone',
    async () => {
      const claimed = await api.create({
        sessionId: NEW,
        organizationId: ORG,
        profile: 'agent',
      });
      expectStatus(
        claimed.reply,
        201,
        'create from the pool of the next version',
      );
      report.add(
        'create from the pool of the next version (a claim)',
        claimed.elapsedMs,
      );
      const cold = await api.create({
        sessionId: COLD,
        organizationId: ORG,
        profile: 'agent-light',
      });
      expectStatus(cold.reply, 201, 'a cold create on the next version');
      for (const id of [NEW, COLD]) {
        const instance = await sessionInstance(id);
        expect({ id, image: await baseImage(instance?.name ?? '') }).toEqual({
          id,
          image: after,
        });
        expect({ id, version: await version(id) }).toEqual({
          id,
          version: 'next',
        });
      }
      // The old session still runs, on the old version, and works.
      expect(await version(OLD)).toBe('none');
      expect(await sh(api, OLD, 'cat /agent/marker')).toBe('before\n');
      for (const id of [OLD, NEW, COLD]) {
        expectStatus(await api.destroy(id), 200, `destroy ${id}`);
      }
    },
  );
});
