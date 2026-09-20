import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  ENSURE_SANDBOX_RUNTIME_SCRIPT,
  SANDBOX_RUNTIME_BUILD_STEP,
  SANDBOX_RUNTIME_IMAGE,
  sandboxRuntimeUnavailable,
} from './dev-sandbox-runtime';

// The shipped tree is the fixture: the tag `bun dev` guarantees must be the
// one the spawner runs, the one compose hands the spawner, and the one the
// build recipe produces — a rename in any one place alone would let `bun dev`
// build an image the spawner never looks for.
const repoRoot = fileURLToPath(new URL('../../..', import.meta.url));
const read = (relative: string): string =>
  readFileSync(join(repoRoot, relative), 'utf8');

describe('the sandbox runtime image `bun dev` guarantees', () => {
  it('is built by the one repo-root recipe, which pins the same tag', () => {
    expect(existsSync(join(repoRoot, ENSURE_SANDBOX_RUNTIME_SCRIPT))).toBe(
      true,
    );
    expect(read(ENSURE_SANDBOX_RUNTIME_SCRIPT)).toContain(
      `const IMAGE = '${SANDBOX_RUNTIME_IMAGE}';`,
    );
  });

  it('is the tag the spawner runs by default, on the host and under compose', () => {
    expect(read('services/sandbox/src/config.ts')).toContain(
      `process.env.SANDBOX_RUNTIME_IMAGE ?? '${SANDBOX_RUNTIME_IMAGE}'`,
    );
    expect(read('compose.yml')).toContain(
      `SANDBOX_RUNTIME_IMAGE: \${SANDBOX_RUNTIME_IMAGE:-${SANDBOX_RUNTIME_IMAGE}}`,
    );
  });

  it('names the image in both step labels', () => {
    expect(SANDBOX_RUNTIME_BUILD_STEP.active).toContain(SANDBOX_RUNTIME_IMAGE);
    expect(SANDBOX_RUNTIME_BUILD_STEP.done).toContain(SANDBOX_RUNTIME_IMAGE);
  });

  it('degrades with the image, the cause and the exact retry command', () => {
    const message = sandboxRuntimeUnavailable(
      new Error('docker exited with code 1'),
    );
    expect(message).toContain(SANDBOX_RUNTIME_IMAGE);
    expect(message).toContain('docker exited with code 1');
    expect(message).toContain(`bun ${ENSURE_SANDBOX_RUNTIME_SCRIPT}`);
    expect(sandboxRuntimeUnavailable('boom')).toContain('(boom)');
  });
});
