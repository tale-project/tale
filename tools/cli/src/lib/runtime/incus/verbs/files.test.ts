import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { copyIntoInstance, copyOutOfInstance, placeOf } from './files';
import {
  POOL,
  seedStackInstance,
  seedStackVolume,
  verbsFixture,
  type VerbsFixture,
} from './verbs-fixture';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

let fixture: VerbsFixture;
let scratch: string;

const ACCOUNTS = {
  '/etc/passwd':
    'root:x:0:0:root:/root:/bin/sh\napp:x:1001:1001::/app:/bin/sh\n',
  '/etc/group': 'root:x:0:\napp:x:1001:\nstaff:x:50:\n',
};

function disk(volume: string, path: string, readonly = false) {
  return {
    type: 'disk',
    pool: POOL,
    source: volume,
    path,
    ...(readonly ? { readonly: 'true' } : {}),
  };
}

/** A source tree: two files, one in a sub-directory. */
function sourceTree(): string {
  const source = join(scratch, 'source');
  mkdirSync(join(source, 'acme'), { recursive: true, mode: 0o750 });
  writeFileSync(join(source, 'top.json'), '{"a":1}', { mode: 0o640 });
  writeFileSync(join(source, 'acme', 'agent.json'), '{"b":2}', {
    mode: 0o600,
  });
  return source;
}

beforeEach(() => {
  fixture = verbsFixture();
  scratch = mkdtempSync(join(tmpdir(), 'tale-incus-files-'));
  seedStackVolume(fixture.fake, 'config-data');
  seedStackVolume(fixture.fake, 'foreign', 'another-stack');
  seedStackInstance(fixture.fake, 'platform', {
    devices: {
      config: disk('config-data', '/app/data', true),
      other: disk('foreign', '/srv/foreign'),
    },
    files: ACCOUNTS,
  });
});
afterEach(() => {
  fixture.remove();
  rmSync(scratch, { recursive: true, force: true });
});

describe('where a path is written', () => {
  test('a path on a stack volume goes to the volume, anything else to the instance', async () => {
    const instance = fixture.fake.instances.get('platform');
    if (instance === undefined) throw new Error('no platform');
    const read = (await fixture.context.client.getInstance('platform'))
      ?.instance;
    if (read === undefined) throw new Error('no platform');
    expect(await placeOf(fixture.context, read, '/app/data/acme/')).toEqual({
      target: { pool: POOL, volume: 'config-data' },
      path: '/acme',
    });
    expect(await placeOf(fixture.context, read, '/app/data')).toEqual({
      target: { pool: POOL, volume: 'config-data' },
      path: '/',
    });
    // Another stack's volume, and a path beside the mount, stay inside.
    expect(await placeOf(fixture.context, read, '/srv/foreign/x')).toEqual({
      target: { instance: 'platform' },
      path: '/srv/foreign/x',
    });
    expect(await placeOf(fixture.context, read, '/app/database')).toEqual({
      target: { instance: 'platform' },
      path: '/app/database',
    });
  });
});

describePosix('copyIn', () => {
  test('writes a read-only mounted config store through its volume, as the owner, keeping modes', async () => {
    const result = await copyIntoInstance(
      fixture.context,
      'platform',
      sourceTree(),
      '/app/data/',
      { user: 'app', group: 'app' },
    );
    expect(result).toEqual({ success: true });
    const files = fixture.fake.volumes.get('config-data')?.files;
    expect(files?.get('/top.json')).toMatchObject({
      content: '{"a":1}',
      uid: 1001,
      gid: 1001,
      mode: '0640',
    });
    expect(files?.get('/acme')).toMatchObject({
      type: 'directory',
      uid: 1001,
      mode: '0750',
    });
    expect(files?.get('/acme/agent.json')).toMatchObject({
      content: '{"b":2}',
      mode: '0600',
    });
    expect(fixture.fake.seen('POST /1.0/instances/platform/files')).toEqual([]);
  });

  test('writes elsewhere through the instance, as root without an owner', async () => {
    const result = await copyIntoInstance(
      fixture.context,
      'platform',
      sourceTree(),
      '/tmp/import',
    );
    expect(result).toEqual({ success: true });
    const files = fixture.fake.instances.get('platform')?.files;
    expect(files?.get('/tmp/import')).toMatchObject({ type: 'directory' });
    expect(files?.get('/tmp/import/acme/agent.json')).toMatchObject({
      content: '{"b":2}',
      uid: 0,
      gid: 0,
    });
  });

  test('an owner the instance does not know, a missing instance and a symlink fail', async () => {
    expect(
      await copyIntoInstance(fixture.context, 'platform', sourceTree(), '/x', {
        user: 'nobody-here',
        group: 'app',
      }),
    ).toMatchObject({ success: false, stage: 'owner' });
    expect(
      await copyIntoInstance(fixture.context, 'gone', sourceTree(), '/x'),
    ).toMatchObject({ success: false, stage: 'copy' });
    const linked = join(scratch, 'linked');
    mkdirSync(linked);
    symlinkSync('/etc/passwd', join(linked, 'passwd'));
    expect(
      await copyIntoInstance(fixture.context, 'platform', linked, '/x'),
    ).toMatchObject({ success: false, stage: 'copy' });
  });
});

describePosix('copyOut', () => {
  test('walks the directory into 0600 files, and stops at the byte cap', async () => {
    await copyIntoInstance(
      fixture.context,
      'platform',
      sourceTree(),
      '/app/data/',
    );
    const out = join(scratch, 'out');
    const copied = await copyOutOfInstance(
      fixture.context,
      'platform',
      '/app/data',
      out,
      { maxBytes: 1_000, timeoutS: 30 },
    );
    expect(copied.success).toBe(true);
    expect(readFileSync(join(out, 'top.json'), 'utf8')).toBe('{"a":1}');
    expect(readFileSync(join(out, 'acme', 'agent.json'), 'utf8')).toBe(
      '{"b":2}',
    );
    expect(statSync(join(out, 'top.json')).mode & 0o777).toBe(0o600);
    expect(statSync(join(out, 'acme')).mode & 0o777).toBe(0o700);

    const capped = await copyOutOfInstance(
      fixture.context,
      'platform',
      '/app/data',
      join(scratch, 'capped'),
      { maxBytes: 10, timeoutS: 30 },
    );
    expect(capped).toMatchObject({ success: false, exitCode: 1 });
    expect(capped.stderr).toContain('more than 10 bytes');
  });

  test('a symlink is named and left, a file or a missing path fails', async () => {
    const files = fixture.fake.instances.get('platform')?.files;
    files?.set('/export/data.json', { content: '{}', mode: '0600' });
    files?.set('/export/link', {
      content: '/etc/passwd',
      mode: '0777',
      type: 'symlink',
    });
    const warn = spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const out = join(scratch, 'export');
      expect(
        (
          await copyOutOfInstance(fixture.context, 'platform', '/export', out, {
            maxBytes: 100,
            timeoutS: 30,
          })
        ).success,
      ).toBe(true);
      expect(readFileSync(join(out, 'data.json'), 'utf8')).toBe('{}');
      expect(warn).toHaveBeenCalledWith(
        '/export/link in platform is a symlink; it is not copied.',
      );
    } finally {
      warn.mockRestore();
    }
    for (const source of ['/export/data.json', '/nothing'])
      expect(
        (
          await copyOutOfInstance(
            fixture.context,
            'platform',
            source,
            join(scratch, 'x'),
            { maxBytes: 100, timeoutS: 30 },
          )
        ).success,
      ).toBe(false);
  });
});
