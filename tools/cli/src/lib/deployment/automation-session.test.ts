import { afterEach, describe, expect, test } from 'bun:test';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { exec } from '../docker/exec';
import { runtimeProcessEnvironment } from './runtime-command';

const directories: string[] = [];
afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

// A child process owns PATH; no test changes the parent runner's Docker command.
// The fake Docker is a real process with real OS pipes, never a promise mock.
async function transport(fake: string, script: string) {
  const directory = mkdtempSync(join(tmpdir(), 'tale-cutover-pipe-test-'));
  directories.push(directory);
  writeFileSync(join(directory, 'docker'), `#!${process.execPath}\n${fake}\n`, {
    mode: 0o700,
  });
  return exec(
    process.execPath,
    [
      '-e',
      `import { automationSession } from ${JSON.stringify(new URL('./automation-session.ts', import.meta.url).href)};\n${script}`,
    ],
    {
      silent: true,
      timeout: 12,
      maxOutputBytes: 16_384,
      env: {
        ...runtimeProcessEnvironment(),
        PATH: `${directory}:${process.env.PATH ?? ''}`,
      },
    },
  );
}

describe.skipIf(process.platform === 'win32')(
  'bounded automation lock transport',
  () => {
    test('close deadline covers stdin backpressure as well as process exit', async () => {
      const result = await transport(
        'await Bun.sleep(60_000);',
        `
const session = await automationSession('${'a'.repeat(64)}');
const query = session.query(' '.repeat(4_000_000)).catch(() => 'refused');
const started = performance.now();
await session.close();
console.log(JSON.stringify({ elapsed: performance.now() - started, query: await query, healthy: session.healthy() }));
`,
      );
      expect(result.success).toBe(true);
      const observed = JSON.parse(result.stdout);
      expect(observed.query).toBe('refused');
      expect(observed.healthy).toBe(false);
      expect(observed.elapsed).toBeLessThan(8_000);
    }, 15_000);

    test('oversized output and private subprocess errors revoke the session without rendering payloads', async () => {
      for (const fake of [
        "process.stdout.write('x'.repeat(1_048_577)); await Bun.sleep(60_000);",
        "console.error('SYNTHETIC_PRIVATE_DATABASE_VALUE'); process.exit(1);",
      ]) {
        const result = await transport(
          fake,
          `
const session = await automationSession('${'a'.repeat(64)}');
let refused = false;
try { await session.query('SELECT 1;'); } catch (error) { refused = !String(error).includes('SYNTHETIC_PRIVATE_DATABASE_VALUE'); }
await session.close();
console.log(JSON.stringify({ refused, healthy: session.healthy() }));
`,
        );
        expect(result.success).toBe(true);
        expect(JSON.parse(result.stdout)).toEqual({
          refused: true,
          healthy: false,
        });
        expect(result.stdout + result.stderr).not.toContain(
          'SYNTHETIC_PRIVATE_DATABASE_VALUE',
        );
      }
    }, 15_000);
  },
);
