import { expect, test } from 'bun:test';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const smoke = resolve(import.meta.dir, 'smoke.test.ts');
const dev = resolve(import.meta.dir, 'fixtures/dev-command.ts');
const title =
  'dev from a parent dir points at the child project, not a re-init';

test.each([
  { label: 'valid child', removeChild: false },
  { label: 'missing child', removeChild: true },
])(
  'parent-directory smoke owns only the dev guard ($label)',
  ({ removeChild }) => {
    const directory = mkdtempSync(join(tmpdir(), 'tale-smoke-guard-'));
    try {
      const preload = join(directory, 'guard.ts');
      const calls = join(directory, 'calls.jsonl');
      const binary = join(directory, 'guard-binary');
      writeFileSync(
        preload,
        `import { appendFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
const nativeSpawn = Bun.spawn;
Bun.spawn = (command, options) => {
  // Intercept only this regression's owned stub path.
  if (!Array.isArray(command) || command[0] !== ${JSON.stringify(binary)})
    return nativeSpawn(command, options);
  appendFileSync(process.env.TALE_SMOKE_GUARD_CALLS, JSON.stringify(command.slice(1)) + '\\n');
  if (command.length !== 2 || command[1] !== 'dev')
    throw new Error('Parent-directory guidance must not initialize a project.');
  if (process.env.TALE_SMOKE_GUARD_REMOVE_CHILD === 'true')
    rmSync(join(options.cwd, 'proj', 'tale.json'));
  return nativeSpawn([process.execPath, '--no-install', ${JSON.stringify(dev)}, 'dev'], {
    ...options,
    env: { ...process.env, TALE_DEV_TEST_SCENARIO: 'parent' },
  });
};
`,
      );
      const result = spawnSync(
        process.execPath,
        [
          '--no-install',
          'test',
          '--preload',
          preload,
          smoke,
          '--test-name-pattern',
          title,
        ],
        {
          cwd: resolve(import.meta.dir, '..'),
          env: {
            ...process.env,
            TALE_BINARY: binary,
            TALE_SMOKE_GUARD_CALLS: calls,
            TALE_SMOKE_GUARD_REMOVE_CHILD: String(removeChild),
          },
          encoding: 'utf8',
          timeout: 10_000,
        },
      );
      expect(result.error).toBeUndefined();
      if (!removeChild && result.status !== 0)
        throw new Error(result.stdout + result.stderr);
      expect(result.status).toBe(removeChild ? 1 : 0);
      expect(result.stderr).toContain(title);
      expect(readFileSync(calls, 'utf8')).toBe('["dev"]\n');
      if (removeChild) {
        expect(result.stderr).toContain('(fail)');
        expect(result.stderr).toContain(
          'Parent guidance must not initialize a project',
        );
      } else expect(result.stderr).toContain('(pass)');
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
