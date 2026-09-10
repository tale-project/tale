import { describe, expect, test } from 'bun:test';
import { fileURLToPath } from 'node:url';

import type { ExecResult } from './exec';

const fixture = fileURLToPath(
  new URL('../../../tests/fixtures/exec-environment.ts', import.meta.url),
);

/** Existing Docker unit tests mock exec globally. A separate process must
 * exercise the real implementation, including both stdin branches. */
async function runFixture(mode: 'explicit' | 'inherited') {
  const child = Bun.spawn([process.execPath, fixture, mode], {
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: {
      PATH: process.env.PATH,
      TALE_EXEC_ALLOWED: 'ambient value',
      TALE_EXEC_PRIVATE_TEST: 'must-not-inherit',
      VERSION: 'ambient-version',
    },
  });
  const deadline = setTimeout(() => child.kill(), 10_000);
  try {
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode).toBe(0);
    expect(stderr).toBe('');
    const results = JSON.parse(stdout) as ExecResult[];
    expect(results).toHaveLength(2);
    for (const result of results) {
      expect(result.success).toBe(true);
      expect(result.exitCode).toBe(0);
      expect(result.stderr).toBe('');
    }
    return results.map((result) => JSON.parse(result.stdout));
  } finally {
    clearTimeout(deadline);
  }
}

describe('explicit subprocess environment', () => {
  test('replaces ambient deployment and credential variables', async () => {
    expect(await runFixture('explicit')).toEqual([
      { allowed: 'literal $value' },
      { allowed: 'literal $value', stdin: 'literal stdin $value\n' },
    ]);
  }, 15_000);

  test('keeps the existing inherited environment behavior when omitted', async () => {
    const inherited = {
      allowed: 'ambient value',
      private: 'must-not-inherit',
      version: 'ambient-version',
    };
    expect(await runFixture('inherited')).toEqual([
      inherited,
      { ...inherited, stdin: 'literal stdin $value\n' },
    ]);
  }, 15_000);
});
