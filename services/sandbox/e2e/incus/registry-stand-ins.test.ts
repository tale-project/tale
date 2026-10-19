// The stand-in registry caches of the lab: the packages are real archives, the
// lock files name what a lock made against the public registries names, and the
// servers answer the way npm and pip ask. (Real npm, pip, uv and bun installed
// from them when they were written; this keeps them that way without a tool.)

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { crc32, gunzipSync } from 'node:zlib';

import {
  npmProject,
  pipRequirements,
  PROBE_NAME,
  PROBE_VERSION,
  probePackages,
  PYPI_INDEX_PATH,
  serveStandInCaches,
} from './registry-stand-ins.ts';

const packages = probePackages();

/** The entries of an uncompressed tar: name, content, and whether the header's
 * checksum is the one its bytes give. */
function readTar(archive: Buffer) {
  const entries: { name: string; text: string; sound: boolean }[] = [];
  let offset = 0;
  while (offset + 512 <= archive.length) {
    const header = archive.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const name = header.toString('utf8', 0, 100).replace(/\0.*$/s, '');
    const size = Number.parseInt(header.toString('ascii', 124, 135), 8);
    const stored = Number.parseInt(header.toString('ascii', 148, 154), 8);
    let sum = 0;
    for (const [index, byte] of header.entries()) {
      sum += index >= 148 && index < 156 ? 0x20 : byte;
    }
    entries.push({
      name,
      text: archive.toString('utf8', offset + 512, offset + 512 + size),
      sound: sum === stored,
    });
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  return entries;
}

/** The entries of a stored zip, read from its central directory. */
function readZip(archive: Buffer) {
  const end = archive.length - 22;
  expect(archive.readUInt32LE(end)).toBe(0x06054b50);
  const count = archive.readUInt16LE(end + 10);
  let offset = archive.readUInt32LE(end + 16);
  const entries: { name: string; text: string; crcMatches: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    expect(archive.readUInt32LE(offset)).toBe(0x02014b50);
    const crc = archive.readUInt32LE(offset + 16);
    const size = archive.readUInt32LE(offset + 24);
    const nameLength = archive.readUInt16LE(offset + 28);
    const local = archive.readUInt32LE(offset + 42);
    const name = archive.toString(
      'utf8',
      offset + 46,
      offset + 46 + nameLength,
    );
    expect(archive.readUInt32LE(local)).toBe(0x04034b50);
    const start = local + 30 + archive.readUInt16LE(local + 26);
    const data = archive.subarray(start, start + size);
    entries.push({
      name,
      text: data.toString('utf8'),
      crcMatches: crc32(data) === crc,
    });
    offset += 46 + nameLength;
  }
  return entries;
}

describe('the npm package', () => {
  test('is a gzipped tar of a package, with the integrity npm checks', () => {
    const entries = readTar(gunzipSync(packages.npm.tarball));
    expect(entries.map((entry) => entry.name)).toEqual([
      'package/package.json',
      'package/index.js',
    ]);
    expect(entries.every((entry) => entry.sound)).toBe(true);
    expect(JSON.parse(entries[0]?.text ?? '')).toEqual({
      name: PROBE_NAME,
      version: PROBE_VERSION,
      main: 'index.js',
    });
    expect(packages.npm.integrity).toBe(
      `sha512-${createHash('sha512').update(packages.npm.tarball).digest('base64')}`,
    );
  });

  test('is locked the way a lock made against the public registry locks it', () => {
    const project = npmProject(packages);
    expect(Object.keys(project)).toEqual(['package.json', 'package-lock.json']);
    const lock = JSON.parse(project['package-lock.json'] ?? '');
    expect(lock.lockfileVersion).toBe(3);
    expect(lock.packages[`node_modules/${PROBE_NAME}`]).toEqual({
      version: PROBE_VERSION,
      resolved: `https://registry.npmjs.org/${PROBE_NAME}/-/${PROBE_NAME}-${PROBE_VERSION}.tgz`,
      integrity: packages.npm.integrity,
    });
    expect(JSON.parse(project['package.json'] ?? '').dependencies).toEqual({
      [PROBE_NAME]: PROBE_VERSION,
    });
  });
});

describe('the Python wheel', () => {
  test('is a zip of a package and its metadata, with a RECORD that tells the truth', () => {
    const entries = readZip(packages.wheel.bytes);
    expect(entries.map((entry) => entry.name)).toEqual([
      'tale_e2e_probe/__init__.py',
      'tale_e2e_probe-1.0.0.dist-info/METADATA',
      'tale_e2e_probe-1.0.0.dist-info/WHEEL',
      'tale_e2e_probe-1.0.0.dist-info/RECORD',
    ]);
    expect(entries.every((entry) => entry.crcMatches)).toBe(true);
    const record = entries.at(-1)?.text.trim().split('\n') ?? [];
    for (const entry of entries.slice(0, -1)) {
      const hash = createHash('sha256').update(entry.text).digest('base64url');
      expect(record).toContain(
        `${entry.name},sha256=${hash},${Buffer.byteLength(entry.text)}`,
      );
    }
    expect(record.at(-1)).toBe('tale_e2e_probe-1.0.0.dist-info/RECORD,,');
    expect(packages.wheel.fileName).toBe(
      'tale_e2e_probe-1.0.0-py3-none-any.whl',
    );
    expect(packages.wheel.sha256).toBe(
      createHash('sha256').update(packages.wheel.bytes).digest('hex'),
    );
  });

  test('is locked by hash', () => {
    expect(pipRequirements(packages)).toBe(
      `tale-e2e-probe==1.0.0 --hash=sha256:${packages.wheel.sha256}\n`,
    );
  });
});

describe('the servers', () => {
  const caches = serveStandInCaches({
    hostname: '127.0.0.1',
    npmPort: 0,
    pypiPort: 0,
  });
  afterAll(() => caches.stop());

  test('serve the npm package as Verdaccio does: the packument names the tarball on the same origin', async () => {
    const tarballUrl = `${caches.npmUrl}${PROBE_NAME}/-/${PROBE_NAME}-${PROBE_VERSION}.tgz`;
    const packument: unknown = await (
      await fetch(`${caches.npmUrl}${PROBE_NAME}`)
    ).json();
    expect(packument).toMatchObject({
      name: PROBE_NAME,
      'dist-tags': { latest: PROBE_VERSION },
      versions: {
        [PROBE_VERSION]: {
          dist: { integrity: packages.npm.integrity, tarball: tarballUrl },
        },
      },
    });
    const tarball = Buffer.from(await (await fetch(tarballUrl)).arrayBuffer());
    expect(tarball.equals(packages.npm.tarball)).toBe(true);
  });

  test('serve the wheel as devpi does: a simple page that links the file, which is served', async () => {
    const page = await (await fetch(`${caches.pypiUrl}${PROBE_NAME}/`)).text();
    const link = /href="([^"#]+)#sha256=([0-9a-f]+)"/.exec(page);
    expect(link?.[2]).toBe(packages.wheel.sha256);
    const origin = new URL(caches.pypiUrl).origin;
    for (const path of [
      link?.[1] ?? '',
      (link?.[1] ?? '').replace('+f', '%2Bf'),
    ]) {
      const wheel = Buffer.from(
        await (await fetch(`${origin}${path}`)).arrayBuffer(),
      );
      expect(wheel.equals(packages.wheel.bytes)).toBe(true);
    }
    expect(new URL(caches.pypiUrl).pathname).toBe(PYPI_INDEX_PATH);
  });

  test('know nothing else, like a cache whose upstream does not either, and log every request', async () => {
    const before = caches.requests.length;
    expect((await fetch(`${caches.npmUrl}left-pad`)).status).toBe(404);
    expect((await fetch(`${caches.pypiUrl}requests/`)).status).toBe(404);
    expect(
      caches.requests.slice(before).map((line) => line.split(' ').slice(1)),
    ).toEqual([
      ['GET', '/left-pad'],
      ['GET', '/root/pypi/+simple/requests/'],
    ]);
    expect(
      caches.requests.slice(before).every((line) => /^\d+ /.test(line)),
    ).toBe(true);
  });
});
