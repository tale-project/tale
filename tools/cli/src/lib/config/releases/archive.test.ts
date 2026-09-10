import { expect, test } from 'bun:test';
import { execFileSync } from 'node:child_process';

import JSZip from 'jszip';

import { archive, unpack } from './archive';
import { committedEntries } from './git';
import { gitTreeHash } from './snapshot';
import { fixture } from './tests/fixture';

async function zipFile(
  name = 'file.txt',
  bytes = Buffer.from('safe bytes'),
  mode = 0o100644,
) {
  const zip = new JSZip();
  zip.file(name, bytes, { createFolders: false, unixPermissions: mode });
  return zip.generateAsync({
    type: 'nodebuffer',
    platform: 'UNIX',
    compression: 'DEFLATE',
  });
}
function central(bytes: Buffer): number {
  return bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
}

test('central-directory duplicates and reported expansion are rejected before extraction', async () => {
  const duplicate = execFileSync('python3', [
    '-c',
    'import io,zipfile,sys,warnings; warnings.simplefilter("ignore"); b=io.BytesIO(); z=zipfile.ZipFile(b,"w"); z.writestr("same.txt","first"); z.writestr("same.txt","second"); z.close(); sys.stdout.buffer.write(b.getvalue())',
  ]);
  await expect(unpack(duplicate)).rejects.toThrow('duplicate archive path');
  const huge = await zipFile();
  huge.writeUInt32LE(100_000_001, central(huge) + 24);
  await expect(unpack(huge)).rejects.toThrow('size limit');
  const lying = await zipFile('file.txt', Buffer.alloc(1_000_000, 'x'));
  lying.writeUInt32LE(10, central(lying) + 24);
  await expect(unpack(lying)).rejects.toThrow();
});

test('unsafe paths, special files, encrypted content and CRC corruption cannot be ingested', async () => {
  await expect(unpack(await zipFile('../outside'))).rejects.toThrow();
  await expect(
    unpack(await zipFile('link', Buffer.from('target'), 0o120777)),
  ).rejects.toThrow('regular files');
  const encrypted = await zipFile();
  const at = central(encrypted);
  encrypted.writeUInt16LE(encrypted.readUInt16LE(at + 8) | 1, at + 8);
  await expect(unpack(encrypted)).rejects.toThrow('encrypted');
  const corrupt = await zipFile();
  corrupt.writeUInt32LE(0, central(corrupt) + 16);
  await expect(unpack(corrupt)).rejects.toThrow('checksum');
  await expect(unpack(Buffer.from('not zip'))).rejects.toThrow();
  const empty = new JSZip();
  empty.folder('empty');
  await expect(
    unpack(await empty.generateAsync({ type: 'nodebuffer' })),
  ).rejects.toThrow('no files');
  await expect(
    archive([
      { path: 'same', bytes: Buffer.from('a'), executable: false },
      { path: 'same', bytes: Buffer.from('b'), executable: false },
    ]),
  ).rejects.toThrow('duplicate');
});

test('snapshot Git hashes include every source byte, path and executable mode', () => {
  const f = fixture();
  const packPath = `tale/clients/acme/${f.descriptor.automations[0]!.packPath}`;
  const entries = committedEntries(f.root, f.options.sourceCommit, packPath);
  expect(gitTreeHash(entries)).toBe(
    f.git('rev-parse', `${f.options.sourceCommit}:${packPath}`),
  );
  expect(
    gitTreeHash(
      entries.map((entry) => ({ ...entry, executable: !entry.executable })),
    ),
  ).not.toBe(gitTreeHash(entries));
  const entry = { path: 'same', bytes: Buffer.from('x'), executable: false };
  expect(() => gitTreeHash([entry, entry])).toThrow('duplicate');
  expect(() => gitTreeHash([entry, { ...entry, path: 'same/child' }])).toThrow(
    'collision',
  );
  expect(() => gitTreeHash([{ ...entry, path: '.git/config' }])).toThrow(
    'unsafe',
  );
});
