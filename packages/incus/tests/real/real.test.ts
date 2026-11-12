// @tale/incus against a real Incus: the shapes the spikes measured (S1
// websocket exec over mutual TLS, S6 the file APIs, S7 snapshots and the
// restore aside), plus exec modes 1-2, state changes, logs and image
// aliases. Gated: it runs only with TALE_INCUS_REAL=1, and then needs
// TALE_INCUS_DIR (client.crt, client.key, server.crt of a certificate
// restricted to a throwaway project) — a run asked for without one fails
// instead of passing empty. See README.md beside this file.

import {
  afterAll,
  beforeAll,
  describe,
  expect,
  setDefaultTimeout,
  test,
} from 'bun:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';

import { IncusApiError } from '../../src/api.ts';
import { IncusClient, isIncusNameConflict } from '../../src/client.ts';
import { execOverWebSocket, openExecSession } from '../../src/exec-session.ts';
import {
  EXEC_PAYLOAD_PREFIX,
  execForCode,
  execResult,
  execWithOutput,
} from '../../src/exec.ts';
import { readFile, makeDirectory, writeFile } from '../../src/files.ts';
import {
  copyVolumeFromSnapshot,
  createVolumeSnapshot,
  listVolumeSnapshots,
} from '../../src/snapshots.ts';
import {
  freezeInstance,
  getInstanceState,
  getProjectState,
  startInstance,
  stopInstance,
  unfreezeInstance,
} from '../../src/state.ts';
import { readIncusTlsMaterial } from '../../src/tls.ts';
import { createUnixSocketClient } from '../../src/unix-transport.ts';
import {
  attachDisk,
  detachDevice,
  getStoragePoolResources,
  renameVolume,
} from '../../src/volumes.ts';

const env = process.env;
const REAL = env.TALE_INCUS_REAL === '1';
const DIR = env.TALE_INCUS_DIR ?? '';
const ENDPOINT = env.TALE_INCUS_ENDPOINT ?? 'https://127.0.0.1:8443';
const PROJECT = env.TALE_INCUS_PROJECT ?? 'ti-03';
const POOL = env.TALE_INCUS_POOL ?? 'ti-03';
const NETWORK = env.TALE_INCUS_NETWORK ?? 'ti-03-app';
const PROFILE = env.TALE_INCUS_PROFILE ?? 'tale-stack';
const IMAGE_SERVER = env.TALE_INCUS_IMAGE_SERVER ?? 'https://mirror.gcr.io';
const IMAGE = env.TALE_INCUS_IMAGE ?? 'library/alpine:3.22';
const SOCKET = env.TALE_INCUS_SOCKET ?? '';

if (REAL && DIR === '') {
  throw new Error(
    'TALE_INCUS_REAL=1 needs TALE_INCUS_DIR: the directory of client.crt, client.key and server.crt',
  );
}

setDefaultTimeout(300_000);

const run = Date.now().toString(36);
const names = {
  image: `real-alpine-${run}`,
  instance: `real-${run}`,
  volume: `real-data-${run}`,
  aside: `real-data-${run}.pre-restore`,
};
const text = (bytes: Uint8Array) => new TextDecoder().decode(bytes);
const sha256 = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

describe.skipIf(!REAL)('a real Incus', () => {
  let client: IncusClient;

  beforeAll(async () => {
    client = new IncusClient({
      endpoint: ENDPOINT,
      project: PROJECT,
      tls: await readIncusTlsMaterial({
        clientCertFile: join(DIR, 'client.crt'),
        clientKeyFile: join(DIR, 'client.key'),
        serverCertFile: join(DIR, 'server.crt'),
      }),
      signal: () => undefined,
    });
    await client.pullOciImage(
      { server: IMAGE_SERVER, alias: IMAGE },
      names.image,
      600_000,
    );
    await client.createVolume(POOL, {
      name: names.volume,
      type: 'custom',
      content_type: 'filesystem',
      config: { 'security.shifted': 'true' },
    });
    await client.createInstance(
      {
        name: names.instance,
        ephemeral: false,
        profiles: [PROFILE],
        config: {
          'security.idmap.isolated': 'true',
          'oci.entrypoint': '/bin/sleep infinity',
          'environment.TALE_PROBE': 'from-config',
        },
        devices: {
          eth0: { type: 'nic', network: NETWORK, name: 'eth0' },
          data: {
            type: 'disk',
            pool: POOL,
            source: names.volume,
            path: '/data',
          },
        },
        source: { type: 'image', alias: names.image },
        start: true,
      },
      300_000,
    );
  });

  afterAll(async () => {
    if (client === undefined) return;
    const quiet = (what: string) => (error: unknown) => {
      console.warn(
        `[real] cleanup of ${what}:`,
        error instanceof Error ? error.message : error,
      );
      return undefined;
    };
    await stopInstance(client, names.instance, {
      timeoutSeconds: 1,
      force: true,
    }).catch(quiet('stop'));
    await client
      .deleteInstance(names.instance, 120_000)
      .catch(quiet('instance'));
    for (const volume of [names.volume, names.aside]) {
      await client.deleteVolume(POOL, volume).catch(quiet(volume));
    }
    const alias = await client.getImageAlias(names.image).catch(quiet('alias'));
    if (alias !== undefined) {
      await client.deleteImage(alias.target, 120_000).catch(quiet('image'));
    }
  });

  test('what the server and the project report', async () => {
    const server = await client.getServer();
    expect(server.auth).toBe('trusted');
    expect(server.apiExtensions).toContain('file_storage_volume');
    expect((await client.getProject()).config.restricted).toBe('true');
    const state = await getProjectState(client);
    expect(state.resources.instances?.usage).toBeGreaterThanOrEqual(1);
    console.info('[real] project state', JSON.stringify(state.resources));
    const room = await getStoragePoolResources(client, POOL);
    expect(room.space.total).toBeGreaterThan(room.space.used);
    console.info('[real] pool resources', JSON.stringify(room));
  });

  test('mode 1: the exit code, the instance environment, stdin through a file that is gone after', async () => {
    expect(
      await execForCode(client, names.instance, ['sh', '-c', 'exit 7'], {
        timeoutSeconds: 10,
      }),
    ).toBe(7);
    expect(
      await execForCode(
        client,
        names.instance,
        ['sh', '-c', 'test "$TALE_PROBE" = from-config && test "$EXTRA" = 1'],
        { timeoutSeconds: 10, environment: { EXTRA: '1' } },
      ),
    ).toBe(0);
    const payload = 'SELECT 1;\n'.repeat(1000);
    expect(
      await execForCode(
        client,
        names.instance,
        ['sh', '-c', 'cat > /tmp/got && ls /dev/shm > /tmp/shm'],
        { timeoutSeconds: 10, stdin: payload, user: 0 },
      ),
    ).toBe(0);
    const got = await readFile(
      client,
      { instance: names.instance },
      '/tmp/got',
    );
    expect(got?.type === 'file' && text(got.content)).toBe(payload);
    const shm = await readFile(
      client,
      { instance: names.instance },
      '/tmp/shm',
    );
    expect(shm?.type === 'file' && text(shm.content)).not.toContain(
      EXEC_PAYLOAD_PREFIX,
    );
  });

  test('mode 1: the image’s timeout ends a command inside the instance', async () => {
    const started = Date.now();
    const code = await execForCode(client, names.instance, ['sleep', '60'], {
      timeoutSeconds: 2,
      timeoutCommand: '/usr/bin/timeout',
    });
    expect(code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(20_000);
    console.info(`[real] timeout exit code ${code}`);
  });

  test('mode 2: both streams, the code, and no exec-output file left', async () => {
    const result = await execWithOutput(
      client,
      names.instance,
      ['sh', '-c', 'echo out; echo err >&2; exit 3'],
      { timeoutSeconds: 10, maxOutputBytes: 1024 },
    );
    expect(result.exitCode).toBe(3);
    expect(text(result.stdout)).toBe('out\n');
    expect(text(result.stderr)).toBe('err\n');
    const left = await client.sync(
      'GET',
      `/1.0/instances/${names.instance}/logs/exec-output`,
      { query: { project: PROJECT } },
    );
    expect(left).toEqual([]);
    const over = await execWithOutput(
      client,
      names.instance,
      ['sh', '-c', 'head -c 4096 /dev/zero'],
      { timeoutSeconds: 10, maxOutputBytes: 1000 },
    ).catch((error: unknown) => error);
    expect(over instanceof Error && over.message).toBe(
      'Command output exceeded its byte limit.',
    );
    expect(
      await client.sync(
        'GET',
        `/1.0/instances/${names.instance}/logs/exec-output`,
        {
          query: { project: PROJECT },
        },
      ),
    ).toEqual([]);
  });

  test('a record-output exec cannot be cancelled', async () => {
    const operation = await client.startOperation(
      'POST',
      `/1.0/instances/${names.instance}/exec`,
      {
        query: { project: PROJECT },
        json: {
          command: ['sleep', '2'],
          'record-output': true,
          'wait-for-websocket': false,
          interactive: false,
        },
      },
    );
    const refused = await client
      .cancelOperation(operation.id)
      .catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(IncusApiError);
    expect(refused instanceof Error && refused.message).toContain(
      "can't be cancelled",
    );
    const done = await client.waitOperation(operation, 30_000);
    for (const path of Object.values(execResult(done).output)) {
      await client.sync('DELETE', path, { query: { project: PROJECT } });
    }
  });

  test('S1: a websocket exec carries 16 MiB of stdin byte-equal', async () => {
    const stdin = new Uint8Array(16 * 1024 * 1024);
    for (let at = 0; at < stdin.length; at += 65536) {
      crypto.getRandomValues(stdin.subarray(at, at + 65536));
    }
    const result = await execOverWebSocket(
      client,
      names.instance,
      ['sh', '-c', 'sha256sum | cut -d" " -f1; echo to-stderr >&2; exit 5'],
      { stdin, maxOutputBytes: 4096, deadlineMs: 60_000 },
    );
    expect(result.exitCode).toBe(5);
    expect(text(result.stdout).trim()).toBe(sha256(stdin));
    expect(text(result.stderr)).toBe('to-stderr\n');
  });

  test('S1: a held session answers round trips; a signal and a close end it', async () => {
    const lines: string[] = [];
    let wake: () => void = () => undefined;
    const session = await openExecSession(client, names.instance, ['cat'], {
      onOutput: (fd, chunk) => {
        if (fd === 1) lines.push(text(chunk));
        wake();
      },
    });
    for (const line of ['one\n', 'two\n']) {
      const answered = new Promise<void>((resolve) => {
        wake = resolve;
      });
      session.write(line);
      await answered;
    }
    expect(lines.join('')).toBe('one\ntwo\n');
    session.signal(15);
    expect(await session.exit).toBe(143);

    const held = await openExecSession(client, names.instance, ['sleep', '60']);
    const started = Date.now();
    held.close();
    const code = await held.exit;
    expect(code).not.toBe(0);
    expect(Date.now() - started).toBeLessThan(15_000);
    console.info(
      `[real] closed session exit ${code} after ${Date.now() - started} ms`,
    );
  });

  test('S6: the volume and instance file APIs keep owner and mode, seen alike inside', async () => {
    const volume = { pool: POOL, volume: names.volume };
    await makeDirectory(client, volume, '/conf', {
      uid: 1001,
      gid: 1001,
      mode: '0750',
    });
    await writeFile(client, volume, '/conf/app.env', 'A=1\n', {
      uid: 1001,
      gid: 1001,
      mode: '0600',
    });
    await writeFile(client, volume, '/conf/app.env', 'B=2\n', {
      uid: 1001,
      gid: 1001,
      mode: '0600',
      write: 'append',
    });
    const read = await readFile(client, volume, '/conf/app.env');
    expect(read).toMatchObject({
      type: 'file',
      uid: 1001,
      gid: 1001,
      mode: '0600',
    });
    expect(read?.type === 'file' && text(read.content)).toBe('A=1\nB=2\n');
    expect(await readFile(client, volume, '/conf')).toMatchObject({
      type: 'directory',
      entries: ['app.env'],
      uid: 1001,
      mode: '0750',
    });
    await writeFile(
      client,
      { instance: names.instance },
      '/data/conf/pushed',
      'p',
      {
        uid: 70,
        gid: 70,
        mode: '0640',
      },
    );
    const inside = await execWithOutput(
      client,
      names.instance,
      [
        'stat',
        '-c',
        '%n %u:%g %a',
        '/data/conf',
        '/data/conf/app.env',
        '/data/conf/pushed',
      ],
      { timeoutSeconds: 10, maxOutputBytes: 1024 },
    );
    expect(text(inside.stdout)).toBe(
      '/data/conf 1001:1001 750\n/data/conf/app.env 1001:1001 600\n/data/conf/pushed 70:70 640\n',
    );
    expect(await readFile(client, volume, '/nope')).toBeUndefined();
  });

  test('freeze holds the instance, unfreeze lets it go', async () => {
    await freezeInstance(client, names.instance);
    expect((await getInstanceState(client, names.instance)).status).toBe(
      'Frozen',
    );
    await unfreezeInstance(client, names.instance);
    expect((await getInstanceState(client, names.instance)).status).toBe(
      'Running',
    );
  });

  test('S7: snapshot, detach, rename aside with the history, copy back, attach', async () => {
    const volume = { pool: POOL, volume: names.volume };
    const owner = { uid: 0, gid: 0, mode: '0644' };
    await writeFile(client, volume, '/counter', '1', owner);
    await createVolumeSnapshot(client, POOL, names.volume, 'set1');
    await writeFile(client, volume, '/counter', '2', owner);
    expect(
      (await listVolumeSnapshots(client, POOL, names.volume)).map(
        (s) => s.name,
      ),
    ).toEqual(['set1']);

    const attached = await renameVolume(
      client,
      POOL,
      names.volume,
      names.aside,
    ).catch((error: unknown) => error);
    expect(attached instanceof IncusApiError && attached.status).toBe(409);

    const grace = Date.now();
    const graceful = await stopInstance(client, names.instance, {
      timeoutSeconds: 5,
    }).catch((error: unknown) => error);
    console.info(
      `[real] graceful stop: ${graceful instanceof Error ? graceful.message : 'stopped'} after ${Date.now() - grace} ms`,
    );
    if (graceful instanceof Error) {
      await stopInstance(client, names.instance, {
        timeoutSeconds: 1,
        force: true,
      });
    }
    expect((await getInstanceState(client, names.instance)).status).toBe(
      'Stopped',
    );

    const read = await client.getInstance(names.instance);
    if (read?.etag === undefined) throw new Error('Incus sent no ETag');
    expect(
      await detachDevice(client, names.instance, 'data', {
        ifMatch: read.etag,
      }),
    ).toBe(true);
    expect(
      (await client.getInstance(names.instance))?.instance.devices.data,
    ).toBeUndefined();
    const stale = await detachDevice(client, names.instance, 'eth0', {
      ifMatch: read.etag,
    }).catch((error: unknown) => error);
    expect(stale instanceof IncusApiError && stale.status).toBe(412);

    // The file API wrote to the volume just now: Incus holds it mounted for
    // about 15 s after, and the rename waits that out.
    const renameStarted = Date.now();
    await renameVolume(client, POOL, names.volume, names.aside);
    console.info(
      `[real] detached rename (after a file API write) ${Date.now() - renameStarted} ms`,
    );
    expect(
      (await listVolumeSnapshots(client, POOL, names.aside)).map((s) => s.name),
    ).toEqual(['set1']);
    await copyVolumeFromSnapshot(
      client,
      POOL,
      { volume: names.aside, snapshot: 'set1' },
      names.volume,
    );
    const fresh = await client.getVolume(POOL, names.volume);
    expect(fresh?.config['security.shifted']).toBe('true');
    expect(await listVolumeSnapshots(client, POOL, names.volume)).toEqual([]);

    const again = await client.getInstance(names.instance);
    if (again?.etag === undefined) throw new Error('Incus sent no ETag');
    await attachDisk(
      client,
      names.instance,
      'data',
      { pool: POOL, source: names.volume, path: '/data' },
      { ifMatch: again.etag },
    );
    await startInstance(client, names.instance);
    const counter = await execWithOutput(
      client,
      names.instance,
      ['cat', '/data/counter'],
      {
        timeoutSeconds: 10,
        maxOutputBytes: 64,
      },
    );
    expect(text(counter.stdout)).toBe('1');
  });

  test('logs: lxc.log is listed and read; the console reads', async () => {
    expect(await client.listInstanceLogs(names.instance)).toContain('lxc.log');
    const log = await client.readInstanceLog(names.instance, 'lxc.log', {
      maxBytes: 4 * 1024 * 1024,
    });
    // lxc.log is empty for an instance that started without a complaint.
    expect(log).toBeInstanceOf(Uint8Array);
    const console1 = await client.readConsole(names.instance);
    expect(console1).toBeInstanceOf(Uint8Array);
  });

  test('image aliases: made, listed, refused when taken, deleted', async () => {
    const alias = await client.getImageAlias(names.image);
    if (alias === undefined) throw new Error('the pulled image has no alias');
    const second = `${names.image}-2`;
    await client.createImageAlias(second, alias.target);
    expect((await client.listImageAliases()).map((a) => a.name)).toContain(
      second,
    );
    const taken = await client
      .createImageAlias(second, alias.target)
      .catch((error: unknown) => error);
    expect(isIncusNameConflict(taken)).toBe(true);
    expect(await client.deleteImageAlias(second)).toBe(true);
    expect(await client.deleteImageAlias(second)).toBe(false);
  });

  test.skipIf(SOCKET === '')(
    'the Unix socket answers as the admin door',
    async () => {
      const local = createUnixSocketClient({
        socketPath: SOCKET,
        project: PROJECT,
        signal: () => undefined,
      });
      expect((await local.getServer()).auth).toBe('trusted');
      expect((await local.getProject()).name).toBe(PROJECT);
    },
  );
});
