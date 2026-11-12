import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import type { FakeFile, FakeIncus } from '@tale/incus/fake';

import { CliError } from '../../../../utils/fail';
import { clientOf, stackIncus } from '../apply/apply-fixture';
import type { StackImage } from '../compile/stack-target';
import { imageAlias } from '../compile/translate';
import { incusStateDirectory } from '../plan/digest';
import {
  IMAGE_FACTS_FILE,
  imageFsFacts,
  infraFormatsOf,
  passwdUser,
  pathDirectories,
  reapProbes,
} from './image-facts-cache';
import {
  ensureImages,
  pruneImages,
  pullFailure,
  pullSource,
  registryHosts,
} from './images';

let fake: FakeIncus;
let stateRoot: string;

beforeEach(() => {
  fake = stackIncus();
  stateRoot = mkdtempSync(join(tmpdir(), 'tale-incus-images-'));
});

afterEach(() => {
  rmSync(stateRoot, { recursive: true, force: true });
});

function image(repository: string, fill: string): StackImage {
  const digest = `sha256:${fill.repeat(64)}`;
  const reference = `${repository}@${digest}`;
  return {
    alias: imageAlias({ reference, digest }),
    reference,
    digest,
    services: [],
  };
}

const PROXY = image('ghcr.io/tale-project/tale/tale-proxy', 'a');
const PROXY_NEXT = image('ghcr.io/tale-project/tale/tale-proxy', 'b');
const PROXY_LATEST = image('ghcr.io/tale-project/tale/tale-proxy', 'c');
const BGUTIL = image('brainicism/bgutil-ytdlp-pot-provider', 'd');

const pulls = () =>
  fake.seen('POST /1.0/images').map((request) => request.body);

describe('ensureImages', () => {
  test('pulls by digest under the alias, and keeps what the project holds', async () => {
    const client = clientOf(fake);
    const first = await ensureImages(client, [PROXY, BGUTIL], {
      stateRoot,
      registryMirror: 'mirror.gcr.io:443',
    });
    expect(first).toEqual({
      pulled: [BGUTIL.alias, PROXY.alias].sort(),
      kept: [],
      failed: [],
    });
    expect(pulls()).toEqual(
      expect.arrayContaining([
        {
          aliases: [{ name: PROXY.alias }],
          source: {
            type: 'image',
            mode: 'pull',
            protocol: 'oci',
            server: 'https://ghcr.io',
            alias: `tale-project/tale/tale-proxy@sha256:${'a'.repeat(64)}`,
          },
        },
        {
          aliases: [{ name: BGUTIL.alias }],
          source: {
            type: 'image',
            mode: 'pull',
            protocol: 'oci',
            server: 'https://mirror.gcr.io:443',
            alias: `brainicism/bgutil-ytdlp-pot-provider@sha256:${'d'.repeat(64)}`,
          },
        },
      ]),
    );
    const again = await ensureImages(client, [PROXY, BGUTIL], { stateRoot });
    expect(again.pulled).toEqual([]);
    expect(again.kept).toEqual([BGUTIL.alias, PROXY.alias].sort());
    expect(pulls()).toHaveLength(2);
  });

  test('an alias that does not name its digest is refused before any pull', async () => {
    const wrong = { ...PROXY, alias: PROXY_NEXT.alias };
    let error: unknown;
    try {
      await ensureImages(clientOf(fake), [wrong], { stateRoot });
    } catch (caught) {
      error = caught;
    }
    expect(error).toBeInstanceOf(CliError);
    expect(pulls()).toEqual([]);
  });

  test('a failed pull is collected; the others still run', async () => {
    fake.pullFailure = 'manifest unknown';
    const result = await ensureImages(clientOf(fake), [PROXY], { stateRoot });
    expect(result.pulled).toEqual([]);
    expect(result.failed).toEqual([
      {
        reference: PROXY.reference,
        detail: expect.stringContaining('manifest unknown'),
      },
    ]);
    expect(pullFailure(result.failed).message).toContain(PROXY.reference);
  });

  test('a reference without a digest has no pull source', () => {
    expect(() =>
      pullSource('ghcr.io/tale-project/tale/tale-proxy:0.5.104'),
    ).toThrow('by digest only');
    expect(registryHosts([PROXY, BGUTIL])).toEqual(['docker.io', 'ghcr.io']);
    expect(registryHosts([PROXY, BGUTIL], 'mirror.gcr.io:443')).toEqual([
      'ghcr.io',
      'mirror.gcr.io:443',
    ]);
  });
});

describe('pruneImages', () => {
  test('keeps the current image and the one pulled before it, and any in use', async () => {
    const client = clientOf(fake);
    for (const next of [PROXY, PROXY_NEXT, PROXY_LATEST])
      await ensureImages(client, [next], { stateRoot });
    expect(
      await pruneImages(client, [PROXY_LATEST.alias], { stateRoot }),
    ).toEqual([PROXY.alias]);
    expect([...fake.aliases.keys()]).toEqual(
      expect.arrayContaining([PROXY_NEXT.alias, PROXY_LATEST.alias]),
    );
    expect(fake.aliases.has(PROXY.alias)).toBe(false);

    // An instance still runs the oldest: it stays whatever the order says.
    await ensureImages(client, [PROXY], { stateRoot });
    fake.seedInstance('proxy', {
      'user.tale.stack': 'demo',
      'user.tale.image': PROXY.digest,
    });
    await ensureImages(client, [PROXY_LATEST], { stateRoot });
    expect(
      await pruneImages(client, [PROXY_LATEST.alias], { stateRoot }),
    ).toEqual([PROXY_NEXT.alias]);
    expect(fake.aliases.has(PROXY.alias)).toBe(true);
  });

  test('leaves aliases of repositories the target does not run', async () => {
    const client = clientOf(fake);
    await ensureImages(client, [PROXY, BGUTIL], { stateRoot });
    expect(await pruneImages(client, [PROXY.alias], { stateRoot })).toEqual([]);
    expect(fake.aliases.has(BGUTIL.alias)).toBe(true);
  });
});

describe('image facts', () => {
  const dir = (uid: number, gid: number, mode = '0755'): FakeFile => ({
    content: '',
    type: 'directory',
    uid,
    gid,
    mode,
  });

  async function seededImage(): Promise<void> {
    await ensureImages(clientOf(fake), [PROXY], { stateRoot });
    const fingerprint = fake.aliases.get(PROXY.alias) ?? '';
    fake.imageFiles.set(
      fingerprint,
      new Map<string, FakeFile>([
        [
          '/etc/passwd',
          {
            content:
              'root:x:0:0:root:/root:/bin/sh\napp:x:1001:1001::/app:/sbin/nologin\n',
            mode: '0644',
          },
        ],
        ['/data', dir(1001, 1001, '0700')],
        [
          '/usr/bin/timeout',
          { content: '/bin/busybox', type: 'symlink', mode: '0777' },
        ],
      ]),
    );
  }

  const request = (paths: string[]) => ({
    alias: PROXY.alias,
    digest: PROXY.digest,
    env: ['PATH=/usr/local/bin:/usr/bin:/bin'],
    labels: { 'dev.tale.infra-formats': 'switch-upstreams/1' },
    paths,
  });

  test('are read through a stopped probe instance, deleted after, and cached by digest', async () => {
    await seededImage();
    const client = clientOf(fake);
    const facts = await imageFsFacts(client, [request(['/data', '/config'])], {
      stateRoot,
      stack: 'demo',
      now: () => new Date('2026-11-13T00:00:00Z'),
    });
    expect(facts.get(PROXY.digest)).toEqual({
      digest: PROXY.digest,
      paths: {
        '/data': { type: 'directory', uid: 1001, gid: 1001, mode: '0700' },
        '/config': null,
      },
      appUser: { uid: 1001, gid: 1001 },
      timeout: '/usr/bin/timeout',
      infraFormats: ['switch-upstreams/1'],
      readAt: '2026-11-13T00:00:00.000Z',
    });
    const created = fake.seen('POST /1.0/instances');
    expect(created).toHaveLength(1);
    expect(created[0]?.body).toMatchObject({
      start: false,
      profiles: ['tale-stack'],
      config: { 'user.tale.role': 'probe', 'user.tale.stack': 'demo' },
    });
    expect(fake.names()).toEqual([]);
    const file = join(incusStateDirectory(stateRoot), IMAGE_FACTS_FILE);
    expect(statSync(file).mode & 0o777).toBe(0o600);
    expect(
      JSON.parse(readFileSync(file, 'utf8')).images[PROXY.digest].timeout,
    ).toBe('/usr/bin/timeout');

    // The same paths again: no probe instance. A new path: one, for it alone.
    await imageFsFacts(client, [request(['/data'])], {
      stateRoot,
      stack: 'demo',
    });
    expect(fake.seen('POST /1.0/instances')).toHaveLength(1);
    const more = await imageFsFacts(client, [request(['/data', '/srv'])], {
      stateRoot,
      stack: 'demo',
    });
    expect(fake.seen('POST /1.0/instances')).toHaveLength(2);
    expect(Object.keys(more.get(PROXY.digest)?.paths ?? {}).sort()).toEqual([
      '/config',
      '/data',
      '/srv',
    ]);
  });

  test('an image without timeout on its PATH, or without the app user, says so', async () => {
    await seededImage();
    const fingerprint = fake.aliases.get(PROXY.alias) ?? '';
    fake.imageFiles.get(fingerprint)?.delete('/usr/bin/timeout');
    fake.imageFiles.get(fingerprint)?.set('/etc/passwd', {
      content: 'root:x:0:0::/root:/bin/sh\n',
      mode: '0644',
    });
    const facts = await imageFsFacts(clientOf(fake), [request([])], {
      stateRoot,
      stack: 'demo',
    });
    expect(facts.get(PROXY.digest)?.timeout).toBeNull();
    expect(facts.get(PROXY.digest)?.appUser).toBeNull();
  });

  test('a probe instance an interrupted read left behind is reaped', async () => {
    fake.seedInstance(
      'tale-probe-aaaaaaaaaaaa-0a0b0c',
      { 'user.tale.role': 'probe', 'user.tale.stack': 'demo' },
      { status: 'Stopped', ephemeral: false },
    );
    fake.seedInstance(
      'tale-probe-bbbbbbbbbbbb-0a0b0c',
      { 'user.tale.role': 'probe', 'user.tale.stack': 'other' },
      { status: 'Stopped', ephemeral: false },
    );
    expect(await reapProbes(clientOf(fake), 'demo')).toEqual([
      'tale-probe-aaaaaaaaaaaa-0a0b0c',
    ]);
    expect(fake.names()).toEqual(['tale-probe-bbbbbbbbbbbb-0a0b0c']);
  });

  test('passwd, PATH and label parsing', () => {
    expect(passwdUser('app:x:70:71::/:/bin/sh\n', 'app')).toEqual({
      uid: 70,
      gid: 71,
    });
    expect(passwdUser('apple:x:1:1::/:/bin/sh\n', 'app')).toBeNull();
    expect(pathDirectories([])).toContain('/usr/bin');
    expect(pathDirectories(['PATH=/opt/bin:relative:/bin/'])).toEqual([
      '/opt/bin',
      '/bin',
    ]);
    expect(infraFormatsOf({ 'dev.tale.infra-formats': 'a/1, b/2' })).toEqual([
      'a/1',
      'b/2',
    ]);
    expect(infraFormatsOf({})).toEqual([]);
  });
});
