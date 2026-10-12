// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { afterAll, describe, expect, it } from 'vitest';

/**
 * The backend's resolve hook retries a specifier that does not resolve as
 * `.ts`, `.js`, then `/index.ts`. Each candidate that does not exist is a
 * normal step, not news: it printed a line, 26 of them on every process
 * start, because `console.debug` is `console.log` in Node. The trail is a
 * `NODE_DEBUG` section now.
 */

const loader = fileURLToPath(new URL('./node-loader.mjs', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'tale-node-loader-'));
// `./pkg` is a directory: `./pkg.ts` and `./pkg.js` do not exist, so two
// candidates fail before `./pkg/index.ts` resolves.
mkdirSync(join(dir, 'pkg'));
writeFileSync(
  join(dir, 'pkg', 'index.ts'),
  "export const value = 'resolved';\n",
);
writeFileSync(
  join(dir, 'entry.ts'),
  "import { value } from './pkg';\nprocess.stdout.write(value);\n",
);

afterAll(() => {
  rmSync(dir, { recursive: true, force: true });
});

function run(env: Record<string, string> = {}) {
  return spawnSync(
    'node',
    [
      '--experimental-transform-types',
      '--disable-warning=ExperimentalWarning',
      '--import',
      loader,
      join(dir, 'entry.ts'),
    ],
    {
      encoding: 'utf8',
      timeout: 20_000,
      env: { ...process.env, NODE_DEBUG: '', ...env },
    },
  );
}

describe('the backend’s module loader', () => {
  it('resolves an extensionless directory import and prints nothing for the candidates that missed', () => {
    const result = run();

    expect(result.error).toBeUndefined();
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('resolved');
    expect(result.stderr).toBe('');
  });

  it('shows the candidates it tried under NODE_DEBUG=tale-loader', () => {
    const result = run({ NODE_DEBUG: 'tale-loader' });

    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toBe('resolved');
    expect(result.stderr).toContain('candidate failed: ./pkg.ts');
    expect(result.stderr).toContain('candidate failed: ./pkg.js');
  });
});
