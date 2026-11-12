// The file APIs of an instance and of a custom volume: the owner and mode
// travel as headers both ways, every write is octet-stream (a form type
// writes an empty file on Incus), and a path is checked before it is sent.

import { describe, expect, test } from 'bun:test';

import { FakeIncus } from './fake.ts';
import {
  checkFilePath,
  deleteFile,
  makeDirectory,
  readFile,
  statFile,
  writeFile,
  type IncusFileTarget,
} from './files.ts';

async function rejection(promise: Promise<unknown>): Promise<Error> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof Error) return error;
    throw new Error(`rejected with a non-Error: ${String(error)}`, {
      cause: error,
    });
  }
  throw new Error('expected the promise to reject');
}

function setup() {
  const fake = new FakeIncus({ project: 'stack' });
  fake.seedInstance('proxy', {}, { ephemeral: false });
  fake.seedVolume('names-config', {});
  return { fake, client: fake.client() };
}

const targets: Array<[string, IncusFileTarget, string]> = [
  ['an instance', { instance: 'proxy' }, '/1.0/instances/proxy/files'],
  [
    'a custom volume',
    { pool: 'tank', volume: 'names-config' },
    '/1.0/storage-pools/tank/volumes/custom/names-config/files',
  ],
];

describe.each(targets)('the file API of %s', (_label, target, path) => {
  test('a write sends its bytes as octet-stream with owner and mode, and reads back', async () => {
    const { fake, client } = setup();
    const bytes = new Uint8Array([0, 255, 10, 13]);
    await writeFile(client, target, '/hosts.2', bytes, {
      uid: 1001,
      gid: 1002,
      mode: '0640',
    });
    const [write] = fake.seen(`POST ${path}`);
    expect(write?.query).toEqual({ project: 'stack', path: '/hosts.2' });
    expect(write?.headers).toEqual({
      'content-type': 'application/octet-stream',
      'x-incus-type': 'file',
      'x-incus-write': 'overwrite',
      'x-incus-uid': '1001',
      'x-incus-gid': '1002',
      'x-incus-mode': '0640',
    });
    const read = await readFile(client, target, '/hosts.2');
    expect(read).toEqual({
      type: 'file',
      content: bytes,
      uid: 1001,
      gid: 1002,
      mode: '0640',
    });
    expect(await statFile(client, target, '/hosts.2')).toEqual({
      type: 'file',
      uid: 1001,
      gid: 1002,
      mode: '0640',
    });
  });

  test('an append adds to the file', async () => {
    const { client } = setup();
    const owner = { uid: 0, gid: 0, mode: '0600' };
    await writeFile(client, target, '/a', 'A=1\n', owner);
    await writeFile(client, target, '/a', 'B=2\n', {
      ...owner,
      write: 'append',
    });
    const read = await readFile(client, target, '/a');
    expect(
      read?.type === 'file' && new TextDecoder().decode(read.content),
    ).toBe('A=1\nB=2\n');
  });

  test('a directory lists its entries and carries its owner', async () => {
    const { client } = setup();
    await makeDirectory(client, target, '/conf', {
      uid: 1001,
      gid: 1001,
      mode: '0750',
    });
    await writeFile(client, target, '/conf/b', 'x', {
      uid: 1,
      gid: 1,
      mode: '0600',
    });
    await writeFile(client, target, '/conf/a', 'x', {
      uid: 1,
      gid: 1,
      mode: '0600',
    });
    expect(await readFile(client, target, '/conf')).toEqual({
      type: 'directory',
      entries: ['a', 'b'],
      uid: 1001,
      gid: 1001,
      mode: '0750',
    });
  });

  test('a missing path reads as undefined, and a delete says whether it found one', async () => {
    const { client } = setup();
    expect(await readFile(client, target, '/nope')).toBeUndefined();
    expect(await statFile(client, target, '/nope')).toBeUndefined();
    await writeFile(client, target, '/old', 'x', {
      uid: 0,
      gid: 0,
      mode: '0644',
    });
    expect(await deleteFile(client, target, '/old')).toBe(true);
    expect(await deleteFile(client, target, '/old')).toBe(false);
  });

  test('a file over the read cap is refused', async () => {
    const { client } = setup();
    await writeFile(client, target, '/big', new Uint8Array(2048), {
      uid: 0,
      gid: 0,
      mode: '0644',
    });
    expect(
      (await rejection(readFile(client, target, '/big', { maxBytes: 1024 })))
        .message,
    ).toContain('cap');
  });
});

describe('what is refused before it is sent', () => {
  test('a relative path, a path with .. and a NUL', () => {
    expect(() => checkFilePath('etc/passwd')).toThrow('absolute');
    expect(() => checkFilePath('/srv/../etc/passwd')).toThrow('absolute');
    expect(() => checkFilePath('/srv/a\0b')).toThrow('absolute');
    expect(checkFilePath('/srv/a..b')).toBe('/srv/a..b');
  });

  test('an owner or mode that would not be a header value', async () => {
    const { fake, client } = setup();
    const target = { instance: 'proxy' };
    expect(
      (
        await rejection(
          writeFile(client, target, '/x', '', {
            uid: -1,
            gid: 0,
            mode: '0600',
          }),
        )
      ).message,
    ).toContain('uid');
    expect(
      (
        await rejection(
          writeFile(client, target, '/x', '', {
            uid: 0,
            gid: 1.5,
            mode: '0600',
          }),
        )
      ).message,
    ).toContain('gid');
    expect(
      (
        await rejection(
          writeFile(client, target, '/x', '', {
            uid: 0,
            gid: 0,
            mode: '0600\r\nx: y',
          }),
        )
      ).message,
    ).toContain('mode');
    expect(fake.requests).toEqual([]);
  });

  test('the fake writes an empty file for a body without the octet-stream type, as Incus does', async () => {
    const { fake } = setup();
    await fake.fetch(
      'https://incus.fake:8443/1.0/instances/proxy/files?project=stack&path=/f',
      {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new TextEncoder().encode('lost'),
        signal: new AbortController().signal,
        tls: { ca: '', cert: '', key: '' },
      },
    );
    expect(fake.instances.get('proxy')?.files.get('/f')?.content).toBe('');
  });
});

test('the volume file API has no rename, and neither does this module', async () => {
  const exported = Object.keys(await import('./files.ts'));
  expect(exported.filter((name) => /rename|move/i.test(name))).toEqual([]);
});
