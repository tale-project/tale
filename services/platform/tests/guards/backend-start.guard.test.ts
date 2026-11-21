// @vitest-environment node

import { spawnSync } from 'node:child_process';
import {
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
 * map and its source text, about 90 MiB a process (tale-project/tale#4942).
 * The dev image has no build and names its sources in `TALE_BACKEND_DIR`.
 *
 * The real entrypoint runs here as the app user (the `id` double answers
 * 1001, so the root phase is skipped) with a `node` double that records the
 * command line it was given.
 */

const ENTRYPOINT = fileURLToPath(
  new URL('../../docker-entrypoint.sh', import.meta.url),
);
const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function startBackend(role: string, env: Record<string, string> = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), 'backend-start-guard-'));
  tempDirs.push(dir);
  const log = path.join(dir, 'start.log');
  writeFileSync(log, '');
  const doubles = {
    id: 'printf "1001\\n"',
    node: [
      'for argument in "$@"; do printf "%s\\n" "$argument" >> "$START_LOG"; done',
      'printf "ROLE=%s SANDBOX_URL=%s\\n" "$ROLE" "$SANDBOX_URL" >> "$START_LOG"',
    ].join('\n'),
    bun: 'printf "bun\\n" >> "$START_LOG"; exit 97',
  };
  for (const [name, source] of Object.entries(doubles)) {
    writeFileSync(path.join(dir, name), `#!/bin/bash\n${source}\n`, {
      mode: 0o755,
    });
  }
  symlinkSync('/bin/date', path.join(dir, 'date'));
  const result = spawnSync('/bin/bash', [ENTRYPOINT], {
    env: { PATH: dir, START_LOG: log, TALE_ROLE: role, ...env },
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
      const result = startBackend(role);
      expect(result.error).toBeUndefined();
      expect(result.status, result.stderr).toBe(0);
      expect(result.argv).toEqual(['/app/backend-dist/main.js']);
      expect(result.environment).toBe(
        `ROLE=${role} SANDBOX_URL=http://sandbox:8003`,
      );
    },
  );

  it('runs the sources through the type-transforming loader where the image names them (the dev image)', () => {
    const result = startBackend('all', {
      TALE_BACKEND_DIR: '/app/services/platform/backend',
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

  it('keeps a sandbox address the deployment set', () => {
    const result = startBackend('worker', {
      SANDBOX_URL: 'http://spawner.internal:8003',
    });
    expect(result.environment).toBe(
      'ROLE=worker SANDBOX_URL=http://spawner.internal:8003',
    );
  });
});
