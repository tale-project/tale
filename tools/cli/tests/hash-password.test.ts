import { describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { verifyPassword } from 'better-auth/crypto';

const source = fileURLToPath(new URL('../src/index.ts', import.meta.url));
const modes: [string, string[]][] = [
  ['source', [process.execPath, source]],
  ...(process.env.TALE_BINARY
    ? [['compiled', [resolve(process.env.TALE_BINARY)]] as [string, string[]]]
    : []),
];
const password = 'Synthetic!Break-Glass1';

async function run(executable: string[], stdin: string, args: string[] = []) {
  const cwd = await mkdtemp(join(tmpdir(), 'tale-hash-password-'));
  try {
    const child = Bun.spawn([...executable, ...args, 'auth', 'hash-password'], {
      cwd,
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, CI: 'true', TALE_ALIGNED: '' },
    });
    await child.stdin.write(stdin);
    await child.stdin.end();
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    expect(stdout + stderr).not.toContain(password);
    return { stdout, stderr, code };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}

for (const [label, executable] of modes)
  describe(`${label} password hash command`, () => {
    test('prints only a Better Auth hash that the platform verifies', async () => {
      const result = await run(executable, `${password}\n`);
      expect(result.code).toBe(0);
      expect(result.stderr).toBe('');
      expect(result.stdout).toMatch(/^[0-9a-f]{32}:[0-9a-f]{128}\n$/);
      expect(
        await verifyPassword({ hash: result.stdout.trim(), password }),
      ).toBe(true);
    });

    test.each([
      ['a password below the default policy', 'Short-1a\n'],
      ['no password', ''],
    ])('refuses %s with a usage error', async (_name, stdin) => {
      const result = await run(executable, stdin);
      expect(result.code).toBe(2);
      expect(result.stdout).toBe('');
      expect(result.stderr).not.toContain('Short-1a');
    });

    test('a JSON failure envelope carries no password', async () => {
      const result = await run(executable, 'Short-1a\n', ['--json']);
      expect(result.code).toBe(2);
      const envelope = JSON.parse(result.stdout);
      expect(envelope).toMatchObject({ ok: false, error: { code: 2 } });
      expect(result.stdout).not.toContain('Short-1a');
    });
  });
