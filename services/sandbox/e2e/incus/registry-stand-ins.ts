// Stand-ins for the node's package registry caches, so that the lab can show a
// session installing through them: one npm package and one Python wheel, each
// served the way the real cache (Verdaccio for npm, devpi for PyPI) serves a
// package it holds, and a log of every request that reached them. The packages
// are made here, byte for byte, with no tool beyond this file: a tarball and a
// wheel are an archive with a few files in it.
//
// Neither package exists on the public registries under this name, so an
// install that went around the stand-in would find nothing there.

import { createHash } from 'node:crypto';
import { crc32, gzipSync } from 'node:zlib';

export const PROBE_NAME = 'tale-e2e-probe';
export const PROBE_VERSION = '1.0.0';
const PROBE_MODULE = 'tale_e2e_probe';
const WHEEL_FILE = `${PROBE_MODULE}-${PROBE_VERSION}-py3-none-any.whl`;
const TARBALL_PATH = `/${PROBE_NAME}/-/${PROBE_NAME}-${PROBE_VERSION}.tgz`;
/** Where devpi serves the simple index of its `root/pypi` mirror. */
export const PYPI_INDEX_PATH = '/root/pypi/+simple/';
const WHEEL_PATH = `/root/pypi/+f/${WHEEL_FILE}`;

function tarEntry(name: string, content: Buffer): Buffer {
  const header = Buffer.alloc(512);
  header.write(name, 0, 100, 'utf8');
  header.write('0000644\0', 100);
  header.write('0000000\0', 108);
  header.write('0000000\0', 116);
  header.write(`${content.length.toString(8).padStart(11, '0')}\0`, 124);
  header.write('00000000000\0', 136);
  header.write('        ', 148);
  header.write('0', 156);
  header.write('ustar\0', 257);
  header.write('00', 263);
  let sum = 0;
  for (const byte of header) sum += byte;
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148);
  const padding = Buffer.alloc((512 - (content.length % 512)) % 512);
  return Buffer.concat([header, content, padding]);
}

/** A gzipped tar of these files, as `npm pack` makes one. */
function tarball(files: Record<string, string>): Buffer {
  const entries = Object.entries(files).map(([name, text]) =>
    tarEntry(name, Buffer.from(text, 'utf8')),
  );
  return gzipSync(Buffer.concat([...entries, Buffer.alloc(1024)]), {
    level: 9,
  });
}

/** A zip of these files, stored without compression, as a wheel is. */
function zip(files: Record<string, string>): Buffer {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, 'utf8');
    const label = Buffer.from(name, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0x21, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(label.length, 26);
    local.writeUInt16LE(0, 28);
    parts.push(local, label, data);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(0, 10);
    entry.writeUInt16LE(0, 12);
    entry.writeUInt16LE(0x21, 14);
    entry.writeUInt32LE(checksum, 16);
    entry.writeUInt32LE(data.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(label.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, label);
    offset += local.length + label.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(Object.keys(files).length, 8);
  end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, directory, end]);
}

function recordHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64url');
}

export interface ProbePackages {
  npm: { tarball: Buffer; integrity: string; shasum: string };
  wheel: { fileName: string; bytes: Buffer; sha256: string };
}

/** The two packages the stand-ins hold. */
export function probePackages(): ProbePackages {
  const archive = tarball({
    'package/package.json': `${JSON.stringify({ name: PROBE_NAME, version: PROBE_VERSION, main: 'index.js' }, null, 2)}\n`,
    'package/index.js': `module.exports = ${JSON.stringify(PROBE_NAME)};\n`,
  });

  const dist = `${PROBE_MODULE}-${PROBE_VERSION}.dist-info`;
  const content: Record<string, string> = {
    [`${PROBE_MODULE}/__init__.py`]: `NAME = ${JSON.stringify(PROBE_NAME)}\n`,
    [`${dist}/METADATA`]: `Metadata-Version: 2.1\nName: ${PROBE_NAME}\nVersion: ${PROBE_VERSION}\n`,
    [`${dist}/WHEEL`]:
      'Wheel-Version: 1.0\nGenerator: tale-e2e\nRoot-Is-Purelib: true\nTag: py3-none-any\n',
  };
  const record = [
    ...Object.entries(content).map(
      ([name, text]) =>
        `${name},sha256=${recordHash(text)},${Buffer.byteLength(text)}`,
    ),
    `${dist}/RECORD,,`,
    '',
  ].join('\n');
  const wheel = zip({ ...content, [`${dist}/RECORD`]: record });

  return {
    npm: {
      tarball: archive,
      integrity: `sha512-${createHash('sha512').update(archive).digest('base64')}`,
      shasum: createHash('sha1').update(archive).digest('hex'),
    },
    wheel: {
      fileName: WHEEL_FILE,
      bytes: wheel,
      sha256: createHash('sha256').update(wheel).digest('hex'),
    },
  };
}

/** The files of an npm project locked to the probe: `npm ci` needs both. The
 * lock names the public registry, as a lock made against it does; npm sends
 * that host to the registry it is configured with. */
export function npmProject(packages: ProbePackages): Record<string, string> {
  const dependencies = { [PROBE_NAME]: PROBE_VERSION };
  return {
    'package.json': `${JSON.stringify({ name: 'probe-project', version: '1.0.0', private: true, dependencies }, null, 2)}\n`,
    'package-lock.json': `${JSON.stringify(
      {
        name: 'probe-project',
        version: '1.0.0',
        lockfileVersion: 3,
        requires: true,
        packages: {
          '': { name: 'probe-project', version: '1.0.0', dependencies },
          [`node_modules/${PROBE_NAME}`]: {
            version: PROBE_VERSION,
            resolved: `https://registry.npmjs.org${TARBALL_PATH}`,
            integrity: packages.npm.integrity,
          },
        },
      },
      null,
      2,
    )}\n`,
  };
}

/** A requirements file locked to the probe's wheel. */
export function pipRequirements(packages: ProbePackages): string {
  return `${PROBE_NAME}==${PROBE_VERSION} --hash=sha256:${packages.wheel.sha256}\n`;
}

export interface StandInCaches {
  /** The npm registry, as a session is told it. */
  npmUrl: string;
  /** The PyPI simple index, as a session is told it. */
  pypiUrl: string;
  /** Every request that reached either, as `<port> <method> <path>`. */
  requests: readonly string[];
  stop(): Promise<void>;
}

/**
 * Serve the probe packages on `hostname`: npm on `npmPort` and PyPI on
 * `pypiPort` (0 takes a free port, for a test). Anything else is a 404, as a
 * cache answers a package its upstream does not have.
 */
export function serveStandInCaches(options: {
  hostname: string;
  npmPort: number;
  pypiPort: number;
}): StandInCaches {
  const packages = probePackages();
  const requests: string[] = [];
  const note = (server: { port?: number }, request: Request) => {
    requests.push(
      `${String(server.port)} ${request.method} ${new URL(request.url).pathname}`,
    );
  };

  const npm = Bun.serve({
    hostname: options.hostname,
    port: options.npmPort,
    fetch(request, server) {
      note(server, request);
      const url = new URL(request.url);
      if (url.pathname === `/${PROBE_NAME}`) {
        return Response.json({
          name: PROBE_NAME,
          'dist-tags': { latest: PROBE_VERSION },
          versions: {
            [PROBE_VERSION]: {
              name: PROBE_NAME,
              version: PROBE_VERSION,
              main: 'index.js',
              dist: {
                tarball: `${url.origin}${TARBALL_PATH}`,
                integrity: packages.npm.integrity,
                shasum: packages.npm.shasum,
              },
            },
          },
        });
      }
      if (url.pathname === TARBALL_PATH) {
        return new Response(new Uint8Array(packages.npm.tarball), {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });

  const pypi = Bun.serve({
    hostname: options.hostname,
    port: options.pypiPort,
    fetch(request, server) {
      note(server, request);
      // pip writes the `+` of `+f` as %2B; devpi reads both.
      const pathname = decodeURIComponent(new URL(request.url).pathname);
      if (pathname === `${PYPI_INDEX_PATH}${PROBE_NAME}/`) {
        return new Response(
          `<!DOCTYPE html><html><body><a href="${WHEEL_PATH}#sha256=${packages.wheel.sha256}">${packages.wheel.fileName}</a></body></html>\n`,
          { headers: { 'content-type': 'text/html' } },
        );
      }
      if (pathname === WHEEL_PATH) {
        return new Response(new Uint8Array(packages.wheel.bytes), {
          headers: { 'content-type': 'application/octet-stream' },
        });
      }
      return new Response('not found', { status: 404 });
    },
  });

  return {
    npmUrl: `http://${options.hostname}:${String(npm.port)}/`,
    pypiUrl: `http://${options.hostname}:${String(pypi.port)}${PYPI_INDEX_PATH}`,
    requests,
    async stop() {
      await Promise.all([npm.stop(true), pypi.stop(true)]);
    },
  };
}
