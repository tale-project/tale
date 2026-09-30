// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * CI runs `backend:integration` with ITEST_REQUIRE_ALL_LANES=1, and a green
 * run there has to mean that every lane ran. Two conventions make it so:
 *
 * - The harness's own variables (`ITEST_S3_*`, `ITEST_LANES`,
 *   `ITEST_REQUIRE_ALL_LANES`) are read through
 *   `backend/integration-lane-helpers.ts` alone, whose
 *   `fullCoverageBlockers` refuses to start a required run without them. A
 *   lane that read one itself could gate on it where no preflight looks.
 * - Every skip goes through `recordSkip`, which turns it into a failure in a
 *   required run. A lane that recorded its own `(SKIPPED)` pass would stay
 *   green in CI while it never ran.
 */

const BACKEND_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../backend',
);
const HELPERS = 'integration-lane-helpers.ts';

/** The harness and every lane module it mounts, relative to `backend/`. */
function laneFiles(dir = BACKEND_ROOT): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return laneFiles(full);
    const isLane =
      entry.name === 'integration-check.ts' ||
      entry.name.endsWith('.integration.ts') ||
      entry.name.endsWith('-integration.ts');
    return isLane ? [path.relative(BACKEND_ROOT, full)] : [];
  });
}

function offenders(pattern: RegExp): string[] {
  return laneFiles().flatMap((file) =>
    readFileSync(path.join(BACKEND_ROOT, file), 'utf8')
      .split('\n')
      .flatMap((line, index) =>
        pattern.test(line) ? [`${file}:${index + 1}: ${line.trim()}`] : [],
      ),
  );
}

describe('backend:integration lanes', () => {
  it('include the harness and the lane modules it mounts', () => {
    const files = laneFiles();
    expect(files).toContain('integration-check.ts');
    expect(files).toContain('auth/oidc-integration.ts');
    expect(files.length).toBeGreaterThan(40);
    expect(files).not.toContain(HELPERS);
  });

  it(`read the harness's variables only through ${HELPERS}`, () => {
    expect(offenders(/process\.env(\.ITEST_|\[['"`]ITEST_)/)).toEqual([]);
  });

  it('record every skip through recordSkip', () => {
    expect(offenders(/SKIPPED/)).toEqual([]);
  });
});
