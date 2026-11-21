// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterEach, describe, expect, it } from 'vitest';

/**
 * How the image starts the backend. The production image runs the built
 * backend (`scripts/build-backend.ts`) with plain `node`: the loader and
 * `--experimental-transform-types` are what made every module carry a source
 * map and its source text, about 100 MiB a process (tale-project/tale#4942).
 * The dev image has no build and names its sources in `TALE_BACKEND_DIR`.
 *
 * Node sizes its heap for the machine, so the entrypoint works the flags out
 * from the container's own memory limit, which it reads from the cgroup.
 *
 * The real entrypoint runs here as the app user (the `id` double answers
 * 1001, so the root phase is skipped) with a `node` double that records the
 * command line and the environment it was given, and a cgroup directory of
 * the test's own in place of the machine's.
 */

const ENTRYPOINT = fileURLToPath(
  new URL('../../docker-entrypoint.sh', import.meta.url),
);
const MIB = 1024 ** 2;
const BUILT_ENTRY = '/app/backend-dist/main.js';
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

interface Start {
  role?: string;
  env?: Record<string, string>;
  /** The container's limit as cgroup v2 writes it: bytes, or `max`. */
  memoryMax?: string;
  /** The container's limit as cgroup v1 writes it. */
  memoryLimitV1?: string;
}

function startBackend(start: Start = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'backend-start-guard-'));
  tempDirs.push(dir);
  const bin = path.join(dir, 'bin');
  const cgroup = path.join(dir, 'cgroup');
  mkdirSync(bin);
  mkdirSync(cgroup);
  if (start.memoryMax !== undefined)
    writeFileSync(path.join(cgroup, 'memory.max'), `${start.memoryMax}\n`);
  if (start.memoryLimitV1 !== undefined) {
    mkdirSync(path.join(cgroup, 'memory'));
    writeFileSync(
      path.join(cgroup, 'memory', 'memory.limit_in_bytes'),
      `${start.memoryLimitV1}\n`,
    );
  }
  const log = path.join(dir, 'start.log');
  writeFileSync(log, '');
  const doubles = {
    id: 'printf "1001\\n"',
    node: [
      'for argument in "$@"; do printf "%s\\n" "$argument" >> "$START_LOG"; done',
      'printf "ROLE=%s SANDBOX_URL=%s MALLOC_ARENA_MAX=%s\\n" "$ROLE" "$SANDBOX_URL" "$MALLOC_ARENA_MAX" >> "$START_LOG"',
    ].join('\n'),
    bun: 'printf "bun\\n" >> "$START_LOG"; exit 97',
  };
  for (const [name, source] of Object.entries(doubles)) {
    writeFileSync(path.join(bin, name), `#!/bin/bash\n${source}\n`, {
      mode: 0o755,
    });
  }
  symlinkSync('/bin/date', path.join(bin, 'date'));
  const result = spawnSync('/bin/bash', [ENTRYPOINT], {
    env: {
      PATH: bin,
      START_LOG: log,
      TALE_ROLE: start.role ?? 'all',
      TALE_CGROUP_ROOT: cgroup,
      ...start.env,
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  const lines = readFileSync(log, 'utf8').trim().split('\n');
  return { ...result, argv: lines.slice(0, -1), environment: lines.at(-1) };
}

describe('how the image starts the backend', () => {
  it.each(['api', 'worker', 'all'])(
    'runs the built backend with plain node for the %s role: no loader, no type transforming',
    (role) => {
      const result = startBackend({ role });
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.argv).toEqual([BUILT_ENTRY]);
      expect(result.environment).toBe(
        `ROLE=${role} SANDBOX_URL=http://sandbox:8003 MALLOC_ARENA_MAX=2`,
      );
    },
  );

  it('runs the sources through the type-transforming loader where the image names them (the dev image)', () => {
    const result = startBackend({
      env: { TALE_BACKEND_DIR: '/app/services/platform/backend' },
      memoryMax: String(256 * MIB),
    });
    expect(result.status, result.stderr).toBe(0);
    expect(result.argv).toEqual([
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      '/app/services/platform/backend/node-loader.mjs',
      '/app/services/platform/backend/main.ts',
    ]);
  });

  it('keeps a sandbox address and an arena count the deployment set', () => {
    const result = startBackend({
      role: 'worker',
      env: {
        SANDBOX_URL: 'http://spawner.internal:8003',
        MALLOC_ARENA_MAX: '8',
      },
    });
    expect(result.environment).toBe(
      'ROLE=worker SANDBOX_URL=http://spawner.internal:8003 MALLOC_ARENA_MAX=8',
    );
  });
});

describe("node's size, from the container's memory limit", () => {
  it('leaves V8 to size itself where the container has no limit', () => {
    expect(startBackend().argv).toEqual([BUILT_ENTRY]);
    expect(startBackend({ memoryMax: 'max' }).argv).toEqual([BUILT_ENTRY]);
  });

  it('caps the old space at 55 % of a 256 MiB limit, with a 4 MiB semi-space and code tuned for size', () => {
    // V8 on its own would allow a 259 MiB heap here: more than the container.
    expect(startBackend({ memoryMax: String(256 * MIB) }).argv).toEqual([
      '--max-old-space-size=140',
      '--max-semi-space-size=4',
      '--optimize-for-size',
      BUILT_ENTRY,
    ]);
  });

  it.each([
    [384, 211],
    [512, 281],
  ])('scales the old space with the limit: %i MiB allows %i', (limit, heap) => {
    expect(startBackend({ memoryMax: String(limit * MIB) }).argv).toEqual([
      `--max-old-space-size=${heap}`,
      '--max-semi-space-size=4',
      '--optimize-for-size',
      BUILT_ENTRY,
    ]);
  });

  it('never caps the old space below what the backend boots in', () => {
    expect(startBackend({ memoryMax: String(128 * MIB) }).argv).toEqual([
      '--max-old-space-size=96',
      '--max-semi-space-size=4',
      '--optimize-for-size',
      BUILT_ENTRY,
    ]);
  });

  it('halves only the semi-space between 512 MiB and 1 GiB', () => {
    expect(startBackend({ memoryMax: String(513 * MIB) }).argv).toEqual([
      '--max-semi-space-size=8',
      BUILT_ENTRY,
    ]);
    expect(startBackend({ memoryMax: String(1024 * MIB) }).argv).toEqual([
      '--max-semi-space-size=8',
      BUILT_ENTRY,
    ]);
  });

  it('passes no flag above 1 GiB', () => {
    expect(startBackend({ memoryMax: String(1025 * MIB) }).argv).toEqual([
      BUILT_ENTRY,
    ]);
    expect(startBackend({ memoryMax: String(12 * 1024 * MIB) }).argv).toEqual([
      BUILT_ENTRY,
    ]);
  });

  it('reads a cgroup v1 limit, where no limit is a number near 2^63', () => {
    expect(startBackend({ memoryLimitV1: String(256 * MIB) }).argv).toEqual([
      '--max-old-space-size=140',
      '--max-semi-space-size=4',
      '--optimize-for-size',
      BUILT_ENTRY,
    ]);
    expect(startBackend({ memoryLimitV1: '9223372036854771712' }).argv).toEqual(
      [BUILT_ENTRY],
    );
  });

  it("starts with the operator's flags in place of its own, whatever the limit", () => {
    expect(
      startBackend({
        memoryMax: String(256 * MIB),
        env: {
          BACKEND_NODE_FLAGS:
            '--max-old-space-size=200 --max-semi-space-size=2',
        },
      }).argv,
    ).toEqual([
      '--max-old-space-size=200',
      '--max-semi-space-size=2',
      BUILT_ENTRY,
    ]);
  });

  it('says in its log which flags it starts with, and from which limit', () => {
    expect(startBackend({ memoryMax: String(256 * MIB) }).stdout).toContain(
      'INFO  Node flags: --max-old-space-size=140 --max-semi-space-size=4 --optimize-for-size (container memory limit: 256 MiB)',
    );
    expect(startBackend().stdout).toContain(
      'INFO  Node flags: none (container memory limit: none)',
    );
  });

  it('starts with no flag when the operator sets them empty', () => {
    expect(
      startBackend({
        memoryMax: String(256 * MIB),
        env: { BACKEND_NODE_FLAGS: '' },
      }).argv,
    ).toEqual([BUILT_ENTRY]);
  });
});
