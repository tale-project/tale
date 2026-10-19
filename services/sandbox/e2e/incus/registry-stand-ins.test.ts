// The stand-in registry caches of the lab: the packages are real archives, the
// lock files name what a lock made against the public registries names, and the
// servers answer the way npm and pip ask. (Real npm, pip, uv and bun installed
// from them when they were written; this keeps them that way without a tool.)

import { afterAll, describe, expect, test } from 'bun:test';
import { createHash } from 'node:crypto';

import JSZip from 'jszip';

import {
  npmProject,
  pipRequirements,
  PROBE_NAME,
  PROBE_VERSION,
  probePackages,
  PYPI_INDEX_PATH,
  serveStandInCaches,
} from './registry-stand-ins.ts';

const packages = await probePackages();

describe('the npm package', () => {
  test('is a gzipped tar of a package, with the integrity npm checks', async () => {
    // A gzip stream, which Bun reads as the tar it holds.
    expect([...packages.npm.tarball.subarray(0, 2)]).toEqual([0x1f, 0x8b]);
    const entries = await new Bun.Archive(packages.npm.tarball).files();
    expect([...entries.keys()]).toEqual([
      'package/package.json',
      'package/index.js',
    ]);
    expect(
      JSON.parse((await entries.get('package/package.json')?.text()) ?? ''),
    ).toEqual({
      name: PROBE_NAME,
      version: PROBE_VERSION,
      main: 'index.js',
    });
    expect(await entries.get('package/index.js')?.text()).toBe(
      `module.exports = "${PROBE_NAME}";\n`,
    );
    expect(packages.npm.integrity).toBe(
      `sha512-${createHash('sha512').update(packages.npm.tarball).digest('base64')}`,
    );
    expect(packages.npm.shasum).toBe(
      createHash('sha1').update(packages.npm.tarball).digest('hex'),
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
  test('is a zip of a package and its metadata, with a RECORD that tells the truth', async () => {
    const wheel = await JSZip.loadAsync(packages.wheel.bytes, {
      checkCRC32: true,
    });
    const names = Object.keys(wheel.files);
    expect(names).toEqual([
      'tale_e2e_probe/__init__.py',
      'tale_e2e_probe-1.0.0.dist-info/METADATA',
      'tale_e2e_probe-1.0.0.dist-info/WHEEL',
      'tale_e2e_probe-1.0.0.dist-info/RECORD',
    ]);
    const entries: { name: string; text: string }[] = [];
    for (const name of names) {
      const text = await wheel.file(name)?.async('string');
      entries.push({ name, text: text ?? '' });
    }
    const record = entries.at(-1)?.text.trim().split('\n') ?? [];
    for (const entry of entries.slice(0, -1)) {
      const hash = createHash('sha256').update(entry.text).digest('base64url');
      expect(record).toContain(
        `${entry.name},sha256=${hash},${Buffer.byteLength(entry.text)}`,
      );
    }
    expect(record.at(-1)).toBe('tale_e2e_probe-1.0.0.dist-info/RECORD,,');
    // Stored, not compressed: the text is in the bytes as it is.
    expect(packages.wheel.bytes.includes(entries[0]?.text ?? '?')).toBe(true);
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
    packages,
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
