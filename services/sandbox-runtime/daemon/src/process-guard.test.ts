// runnerd is the session container's only process under its init: an error
// nothing handled must not end every exec in the session. A rejection is
// survived; an uncaught exception stops the daemon through its graceful stop
// and exits 70. The second test runs the bundled guard under Node, as the
// image does, whose default ends a process on an unhandled rejection.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import {
  installProcessGuards,
  UNCAUGHT_EXCEPTION_EXIT_CODE,
} from './process-guard.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const hasNode = spawnSync('node', ['--version']).status === 0;

/** Run `body` with console.error captured. */
function quietly(body: () => void): string[] {
  const logged: string[] = [];
  const error = console.error;
  console.error = (...args: unknown[]) => {
    logged.push(args.map(String).join(' '));
  };
  try {
    body();
  } finally {
    console.error = error;
  }
  return logged;
}

describe('installProcessGuards', () => {
  test('logs an unhandled rejection and keeps the daemon running', () => {
    const events = new EventEmitter();
    const stops: number[] = [];
    installProcessGuards({ events, shutdown: (code) => stops.push(code) });
    const logged = quietly(() => {
      events.emit('unhandledRejection', new Error('stray rejection'));
    });
    expect(stops).toEqual([]);
    expect(logged.join('\n')).toContain('unhandled rejection (surviving)');
    expect(logged.join('\n')).toContain('stray rejection');
  });

  test('stops the daemon once on an uncaught exception, with its own exit code', () => {
    const events = new EventEmitter();
    const stops: number[] = [];
    installProcessGuards({ events, shutdown: (code) => stops.push(code) });
    const logged = quietly(() => {
      events.emit('uncaughtException', new Error('boom'), 'uncaughtException');
      events.emit('uncaughtException', new Error('again'), 'uncaughtException');
    });
    expect(UNCAUGHT_EXCEPTION_EXIT_CODE).toBe(70);
    expect(stops).toEqual([70]);
    // Both are said; only the first starts the stop.
    expect(
      logged.filter((line) => line.includes('uncaught exception')),
    ).toHaveLength(2);
  });

  test.skipIf(!hasNode)(
    'under Node, a stray rejection is survived and an uncaught exception exits 70 through the stop',
    async () => {
      const root = mkdtempSync(`${tmpdir()}/runnerd-guard-`);
      roots.push(root);
      writeFileSync(
        `${root}/entry.ts`,
        [
          `import { installProcessGuards } from '${import.meta.dir}/process-guard.ts';`,
          `installProcessGuards({ shutdown: (code) => {`,
          `  console.log('stopping ' + code);`,
          `  setTimeout(() => process.exit(code), 10);`,
          `} });`,
          `void Promise.reject(new Error('stray rejection'));`,
          `setTimeout(() => console.log('survived'), 50);`,
          `setTimeout(() => { throw new Error('boom'); }, 100);`,
          `setTimeout(() => console.log('still running'), 5_000);`,
        ].join('\n'),
      );
      const built = await Bun.build({
        entrypoints: [`${root}/entry.ts`],
        outdir: `${root}/dist`,
        target: 'node',
      });
      expect(built.success).toBe(true);
      const child = spawn('node', [`${root}/dist/entry.js`], {
        stdio: ['ignore', 'pipe', 'ignore'],
      });
      let stdout = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString('utf8');
      });
      const ended = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('still running'), 5_000);
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve(signal ?? `code ${code}`);
        });
      });
      if (ended === 'still running') child.kill('SIGKILL');
      expect(ended).toBe(`code ${UNCAUGHT_EXCEPTION_EXIT_CODE}`);
      expect(stdout).toBe('survived\nstopping 70\n');
    },
    15_000,
  );
});
