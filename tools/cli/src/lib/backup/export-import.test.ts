import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import {
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createSnapshot } from './create-snapshot';
import {
  exportSnapshot,
  importSnapshot,
  readTarHeader,
  tarHeader,
} from './export-import';
import {
  incusBackupFixture,
  type IncusBackupFixture,
} from './incus-backup-fixture';
import { listSnapshots } from './list-snapshots';

// The Incus runtime needs a POSIX host and is refused on Windows
// (assertIncusPlatform): its plan key, journal, credentials and copies are
// held by owner and mode, which Windows files do not carry.
const describePosix = describe.skipIf(process.platform === 'win32');

let source: IncusBackupFixture;
let destination: IncusBackupFixture;
let dir: string;

describe('the tar headers of an export', () => {
  test('round-trip a name and a size, past 8 GiB in base-256', () => {
    for (const size of [
      0,
      1,
      511,
      512,
      8 * 1024 ** 3 - 1,
      9 * 1024 ** 3,
      300 * 1024 ** 3,
    ]) {
      const header = tarHeader(
        '20261113-100000-manual/db-data.tar.gz',
        size,
        0,
      );
      expect(header.byteLength).toBe(512);
      expect(readTarHeader(header)).toEqual({
        name: '20261113-100000-manual/db-data.tar.gz',
        size,
        type: '0',
      });
    }
    expect(readTarHeader(new Uint8Array(512))).toBeNull();
  });

  test('refuse a header whose checksum is wrong', () => {
    const header = Buffer.from(tarHeader('x/manifest.json', 10, 0));
    header[0] = 'y'.charCodeAt(0);
    expect(() => readTarHeader(header)).toThrow(/checksum/);
  });
});

describePosix('export and import on Incus', () => {
  beforeEach(() => {
    source = incusBackupFixture();
    destination = incusBackupFixture();
    dir = mkdtempSync(join(tmpdir(), 'tale-export-'));
  });
  afterEach(() => {
    source.remove();
    destination.remove();
    rmSync(dir, { recursive: true, force: true });
  });

  test('a native set travels as archives: written from snapshot copies, checked out and in, numeric owners kept', async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: '0.5.9',
      runtime: source.runtime,
    });
    if (manifest === null) throw new Error('no snapshot');
    expect(
      Object.values(manifest.volumes).every(
        (info) => info.sha256 === undefined,
      ),
    ).toBe(true);
    const out = join(dir, 'set.tar');
    expect(
      await exportSnapshot({
        runtime: source.runtime,
        prefix: '',
        id: manifest.id,
        to: out,
      }),
    ).toBe(out);
    // The export wrote the archives it lacked, from copies of the snapshots,
    // and recorded them in a new manifest generation.
    expect(
      source.helperCommands.filter((line) => line.includes('tar czf')),
    ).toHaveLength(2);
    const archived = (await listSnapshots('', source.runtime))[0];
    expect(archived?.volumes['db-data']?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(archived?.volumes['db-data']?.native).toBeDefined();
    // No scratch copy is left behind.
    expect(
      (await source.runtime.listVolumes())
        .map((volume) => volume.name)
        .filter((name) => name.includes('.archive-')),
    ).toEqual([]);

    const imported = await importSnapshot({
      runtime: destination.runtime,
      prefix: '',
      file: out,
    });
    expect(imported.id).toBe(manifest.id);
    expect(
      Object.values(imported.volumes).every(
        (info) => info.native === undefined,
      ),
    ).toBe(true);
    const listed = await listSnapshots('', destination.runtime);
    expect(listed.map((entry) => entry.id)).toEqual([manifest.id]);
    expect(destination.text('backups', `/${manifest.id}/db-data.tar.gz`)).toBe(
      source.text('backups', `/${manifest.id}/db-data.tar.gz`),
    );

    // Restored from the archive into a fresh volume: owners as numbers.
    destination.files('db-data').set('/rows', {
      content: 'rows v2',
      mode: '0600',
      uid: 999,
      gid: 999,
      type: 'file',
    });
    await destination.runtime.restoreSnapshot({
      kind: 'start',
      id: manifest.id,
      volumes: ['db-data'],
    });
    expect(destination.text('db-data', '/rows')).toBe('rows v1');
    expect(destination.files('db-data').get('/rows')).toMatchObject({
      uid: 999,
      gid: 999,
    });
  });

  test('an archive that arrives changed is refused, and the snapshot is not listed', async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: null,
      runtime: source.runtime,
      archive: true,
    });
    if (manifest === null) throw new Error('no snapshot');
    const out = join(dir, 'set.tar');
    await exportSnapshot({
      runtime: source.runtime,
      prefix: '',
      id: manifest.id,
      to: out,
    });
    const bytes = readFileSync(out);
    // Flip one byte inside the first archive's data (after two headers and
    // the manifest's blocks).
    const at = bytes.indexOf(Buffer.from('cm93cyB2MQ'));
    expect(at).toBeGreaterThan(0);
    bytes[at] = bytes[at] === 0x63 ? 0x64 : 0x63;
    writeFileSync(out, bytes);
    await expect(
      importSnapshot({ runtime: destination.runtime, prefix: '', file: out }),
    ).rejects.toThrow(/arrived with sha256/);
    expect(await listSnapshots('', destination.runtime)).toEqual([]);
  });

  test('an archive changed on the host since its manifest is refused on the way out, and no file is left', async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: null,
      runtime: source.runtime,
      archive: true,
    });
    if (manifest === null) throw new Error('no snapshot');
    const archive = source
      .files('backups')
      .get(`/${manifest.id}/db-data.tar.gz`);
    if (archive === undefined) throw new Error('no db-data archive');
    const bytes = Buffer.from(archive.bytes ?? Buffer.from(archive.content));
    bytes[0] = (bytes[0] ?? 0) ^ 0xff;
    archive.bytes = bytes;
    archive.content = bytes.toString('latin1');
    const out = join(dir, 'set.tar');
    await expect(
      exportSnapshot({
        runtime: source.runtime,
        prefix: '',
        id: manifest.id,
        to: out,
      }),
    ).rejects.toThrow(/does not match its manifest/);
    expect(readdirSync(dir)).toEqual([]);
  });

  test('never overwrites a file, and refuses a snapshot the host already has', async () => {
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: null,
      runtime: source.runtime,
      archive: true,
    });
    if (manifest === null) throw new Error('no snapshot');
    const out = join(dir, 'set.tar');
    writeFileSync(out, 'mine');
    await expect(
      exportSnapshot({
        runtime: source.runtime,
        prefix: '',
        id: manifest.id,
        to: out,
      }),
    ).rejects.toThrow(/never overwrites/);
    rmSync(out);
    await exportSnapshot({
      runtime: source.runtime,
      prefix: '',
      id: manifest.id,
      to: out,
    });
    await expect(
      importSnapshot({ runtime: source.runtime, prefix: '', file: out }),
    ).rejects.toThrow(/already in backups/);
  });

  test('a file that is no export, or a truncated one, is refused', async () => {
    const junk = join(dir, 'junk.tar');
    writeFileSync(junk, Buffer.alloc(1024, 7));
    await expect(
      importSnapshot({ runtime: destination.runtime, prefix: '', file: junk }),
    ).rejects.toThrow(/checksum|not a snapshot export/);
    const manifest = await createSnapshot({
      prefix: '',
      trigger: 'manual',
      platformVersion: null,
      runtime: source.runtime,
      archive: true,
    });
    if (manifest === null) throw new Error('no snapshot');
    const out = join(dir, 'set.tar');
    await exportSnapshot({
      runtime: source.runtime,
      prefix: '',
      id: manifest.id,
      to: out,
    });
    writeFileSync(out, readFileSync(out).subarray(0, 1500));
    await expect(
      importSnapshot({ runtime: destination.runtime, prefix: '', file: out }),
    ).rejects.toThrow(/truncated/);
  });
});
