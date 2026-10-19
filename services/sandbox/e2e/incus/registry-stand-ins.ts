// Stand-ins for the node's package registry caches, so that the lab can show a
// session installing through them: one npm package and one Python wheel, each
// served the way the real cache (Verdaccio for npm, devpi for PyPI) serves a
// package it holds, and a log of every request that reached them. The packages
// are made here: a tarball is a gzipped tar (Bun's own archive writer) and a
// wheel is a zip (jszip).
//
// Neither package exists on the public registries under this name, so an
// install that went around the stand-in would find nothing there.

import { createHash } from 'node:crypto';

import JSZip from 'jszip';

export const PROBE_NAME = 'tale-e2e-probe';
export const PROBE_VERSION = '1.0.0';
const PROBE_MODULE = 'tale_e2e_probe';
const WHEEL_FILE = `${PROBE_MODULE}-${PROBE_VERSION}-py3-none-any.whl`;
const TARBALL_PATH = `/${PROBE_NAME}/-/${PROBE_NAME}-${PROBE_VERSION}.tgz`;
/** Where devpi serves the simple index of its `root/pypi` mirror. */
export const PYPI_INDEX_PATH = '/root/pypi/+simple/';
const WHEEL_PATH = `/root/pypi/+f/${WHEEL_FILE}`;

/** A gzipped tar of these files, as `npm pack` makes one. */
async function tarball(files: Record<string, string>): Promise<Buffer> {
  return Buffer.from(
    await new Bun.Archive(files, { compress: 'gzip', level: 9 }).bytes(),
  );
}

/** A zip of these files, stored without compression, as a wheel is. The
 * entries carry the first moment a zip can name, so the bytes do not depend on
 * the clock, and no directory entries, which a wheel does not list. */
async function zip(files: Record<string, string>): Promise<Buffer> {
  const archive = new JSZip();
  const date = new Date(Date.UTC(1980, 0, 1));
  for (const [name, text] of Object.entries(files)) {
    archive.file(name, text, { date, createFolders: false });
  }
  return archive.generateAsync({ type: 'nodebuffer', compression: 'STORE' });
}

function recordHash(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('base64url');
}

export interface ProbePackages {
  npm: { tarball: Buffer; integrity: string; shasum: string };
  wheel: { fileName: string; bytes: Buffer; sha256: string };
}

/** The two packages the stand-ins hold. The tarball carries the time it was
 * made, so one run makes the packages once and gives the same ones to the
 * servers and to the lock files. */
export async function probePackages(): Promise<ProbePackages> {
  const archive = await tarball({
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
  const wheel = await zip({ ...content, [`${dist}/RECORD`]: record });

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
  packages: ProbePackages;
}): StandInCaches {
  const { packages } = options;
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
