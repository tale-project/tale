import { afterEach, describe, expect, test } from 'bun:test';
import path from 'node:path';

import { MINIMAL, makeRepo } from './repo-fixture';

const CLI = path.resolve(import.meta.dir, '../cli.ts');

let cleanup: (() => void) | undefined;
afterEach(() => {
  cleanup?.();
  cleanup = undefined;
});

/**
 * The entry point holds only argv and exit-code plumbing, so it is proven the
 * way it is used: as a subprocess, over a checkout on disk.
 */
async function runCli(root?: string) {
  const proc = Bun.spawn(root ? ['bun', CLI, root] : ['bun', CLI], {
    stdout: 'pipe',
    stderr: 'pipe',
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

describe('cli', () => {
  test('this checkout passes its own gate', async () => {
    const { stdout, stderr, exitCode } = await runCli();
    expect(stderr).toBe('');
    expect(stdout).toContain('ok    layout');
    expect(exitCode).toBe(0);
  });

  test('the minimal tree the rules are written against passes', async () => {
    const fixture = makeRepo(MINIMAL);
    cleanup = fixture.cleanup;
    const { stdout, exitCode } = await runCli(fixture.root);
    expect(stdout).toContain('1 tree(s), 1 boxes');
    expect(exitCode).toBe(0);
  });

  test('a broken tree exits 1 and says why', async () => {
    const fixture = makeRepo({
      'services/app/tests/manual/setup.md': '# Setup\n',
    });
    cleanup = fixture.cleanup;
    const { stderr, exitCode } = await runCli(fixture.root);
    expect(stderr).toContain('missing `readme.md`');
    expect(exitCode).toBe(1);
  });
});
