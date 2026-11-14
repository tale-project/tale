import { describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createModuleMocks } from './module-mock-fixture';

const CLI_ROOT = join(import.meta.dir, '..', '..');

describe('createModuleMocks', () => {
  test('restore puts the real module back for every importer', async () => {
    const deployDir = mkdtempSync(join(tmpdir(), 'tale-module-mocks-'));
    try {
      const mocks = createModuleMocks(import.meta.dir);
      await mocks.mockModule('../lib/state/get-current-color', () => ({
        getCurrentColor: async () => undefined,
      }));
      const mocked = await import('../lib/state/get-current-color');
      expect(await mocked.getCurrentColor(deployDir)).toBeUndefined();

      mocks.restore();
      const real = await import('../lib/state/get-current-color');
      // A deploy folder with no state file has no current colour.
      expect(await real.getCurrentColor(deployDir)).toBeNull();
    } finally {
      rmSync(deployDir, { recursive: true, force: true });
    }
  });

  // CI runs every CLI test file in one process, in path order: the colour
  // lifecycle suite runs before the Incus deploy suite, whose flip record
  // refused the `undefined` colour that suite's leaked spy answered.
  test('a suite that mocks the current colour leaves the next suite the real one', async () => {
    const child = Bun.spawn(
      [
        process.execPath,
        'test',
        '--timeout',
        '30000',
        './src/lib/actions/color-lifecycle.test.ts',
        './src/lib/actions/incus-deploy.test.ts',
      ],
      { cwd: CLI_ROOT, stdout: 'pipe', stderr: 'pipe' },
    );
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    const failed = `${stdout}\n${stderr}`
      .split('\n')
      .filter((line) => line.startsWith('(fail)'));
    expect(failed).toEqual([]);
    expect(code).toBe(0);
  }, 120_000);
});
