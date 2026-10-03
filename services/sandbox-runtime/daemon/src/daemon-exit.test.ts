// runnerd's exit must not hang on a /proc read that never comes back:
// `process.exit` waits for libuv's thread pool, and no timer can run while
// it does. The second test runs the bundled code under Node, as the image
// does, with a FIFO no one writes standing in for a stuck process.

import { afterAll, describe, expect, test } from 'bun:test';
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

import { exitDaemon } from './daemon-exit.ts';

const roots: string[] = [];
afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const hasNode = spawnSync('node', ['--version']).status === 0;

describe('exitDaemon', () => {
  test('exits with its code while no process read is out', () => {
    const calls: unknown[] = [];
    exitDaemon(3, {
      pendingReads: () => 0,
      exit: (code) => calls.push(['exit', code]),
      kill: (pid, signal) => calls.push(['kill', pid, signal]),
      pid: 4242,
    });
    expect(calls).toEqual([['exit', 3]]);
  });

  test('ends by SIGKILL while a process read is out', () => {
    const calls: unknown[] = [];
    const warn = console.warn;
    console.warn = () => {};
    try {
      exitDaemon(0, {
        pendingReads: () => 1,
        exit: (code) => calls.push(['exit', code]),
        kill: (pid, signal) => calls.push(['kill', pid, signal]),
        pid: 4242,
      });
    } finally {
      console.warn = warn;
    }
    expect(calls).toEqual([['kill', 4242, 'SIGKILL']]);
  });

  test.skipIf(!hasNode)(
    'the forced deadline ends Node while untracked filesystem I/O is blocked',
    async () => {
      const root = mkdtempSync(`${tmpdir()}/runnerd-io-exit-`);
      roots.push(root);
      const fifo = `${root}/blocked-journal`;
      expect(spawnSync('mkfifo', [fifo]).status).toBe(0);
      writeFileSync(
        `${root}/entry.ts`,
        [
          `import { readFile } from 'node:fs/promises';`,
          `import { exitDaemon } from '${import.meta.dir}/daemon-exit.ts';`,
          `void readFile(process.argv[2]);`,
          `setTimeout(() => exitDaemon(0, { force: true }), 100);`,
        ].join('\n'),
      );
      const built = await Bun.build({
        entrypoints: [`${root}/entry.ts`],
        outdir: `${root}/dist`,
        target: 'node',
      });
      expect(built.success).toBe(true);
      const child = spawn('node', [`${root}/dist/entry.js`, fifo], {
        stdio: 'ignore',
      });
      const ended = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('still running'), 5000);
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve(signal ?? `code ${code}`);
        });
      });
      if (ended === 'still running') child.kill('SIGKILL');
      expect(ended).toBe('SIGKILL');
    },
    15000,
  );

  test.skipIf(!hasNode)(
    'under Node, the daemon ends even though a read of a stuck process never returns',
    async () => {
      const root = mkdtempSync(`${tmpdir()}/runnerd-exit-`);
      roots.push(root);
      const procRoot = `${root}/proc`;
      mkdirSync(`${procRoot}/41`, { recursive: true });
      writeFileSync(
        `${procRoot}/41/stat`,
        '41 (stuck) D 1 41 41 0 -1 0 0 0 0 0 0 0 0 0 20 0 1 0 4141 0 0\n',
      );
      expect(spawnSync('mkfifo', [`${procRoot}/41/environ`]).status).toBe(0);
      const src = import.meta.dir;
      writeFileSync(
        `${root}/entry.ts`,
        [
          `import { exitDaemon } from '${src}/daemon-exit.ts';`,
          `import { taggedPids } from '${src}/process-reaper.ts';`,
          `void taggedPids('e1', { procRoot: process.argv[2], scanDeadlineMs: 100 })`,
          `  .then(() => exitDaemon(0));`,
        ].join('\n'),
      );
      const built = await Bun.build({
        entrypoints: [`${root}/entry.ts`],
        outdir: `${root}/dist`,
        target: 'node',
      });
      expect(built.success).toBe(true);
      const child = spawn('node', [`${root}/dist/entry.js`, procRoot], {
        stdio: 'ignore',
      });
      const ended = await new Promise<string>((resolve) => {
        const timer = setTimeout(() => resolve('still running'), 5_000);
        child.on('exit', (code, signal) => {
          clearTimeout(timer);
          resolve(signal ?? `code ${code}`);
        });
      });
      if (ended === 'still running') child.kill('SIGKILL');
      expect(ended).toBe('SIGKILL');
    },
    15_000,
  );
});
