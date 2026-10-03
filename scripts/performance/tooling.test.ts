import { expect, test } from 'bun:test';
import {
  chmod,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import { prepareToolWorkload } from './tooling';
import { root } from './workloads';

function killFixtureChild(pid: number) {
  try {
    process.kill(pid, 'SIGKILL');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
  }
}

async function readWhenReady(path: string) {
  for (let attempt = 0; attempt < 200; attempt++) {
    try {
      const contents = await readFile(path, 'utf8');
      if (contents) return contents;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
    await delay(10);
  }
  throw new Error(`Fixture did not publish ${path}`);
}

test.skipIf(process.platform === 'win32')(
  'tool cleanup terminates scanner descendants as well as their launcher',
  async () => {
    const directory = await mkdtemp(join(tmpdir(), 'tale-tool-cleanup-'));
    const previousCache = process.env.OPENGREP_CACHE_DIR;
    const fixture = join(directory, 'fixture');
    let childPid: number | undefined;
    let cleanup: (() => void | Promise<void>) | undefined;
    try {
      await mkdir(fixture);
      const runner = await readFile(
        join(root, 'tools/opengrep/run.sh'),
        'utf8',
      );
      const version = /^OPENGREP_VERSION="([^"]+)"$/m.exec(runner)?.[1];
      expect(version).toBeDefined();
      const binary = join(directory, 'cache', String(version), 'opengrep');
      await mkdir(join(directory, 'cache', String(version)), {
        recursive: true,
      });
      const descendant = join(directory, 'descendant.ts');
      await writeFile(
        descendant,
        `import { writeFileSync } from 'node:fs';
process.on('SIGTERM', () => {
  writeFileSync('descendant-terminated', 'yes');
  process.exit(0);
});
writeFileSync('descendant-pid', String(process.pid));
setInterval(() => {}, 1000);
`,
      );
      await writeFile(
        binary,
        `#!${process.execPath}
Bun.spawn([process.execPath, ${JSON.stringify(descendant)}], {
  stdout: 'inherit', stderr: 'inherit',
});
setInterval(() => {}, 1000);
`,
      );
      await chmod(binary, 0o700);
      process.env.OPENGREP_CACHE_DIR = join(directory, 'cache');
      const workload = await prepareToolWorkload(
        'tools.opengrep',
        root,
        fixture,
      );
      cleanup = workload.cleanup;
      // Attach the rejection handler before interrupting the active scan.
      const running = Promise.resolve(workload.run()).then(
        () => undefined,
        (error: unknown) => error,
      );
      childPid = Number(await readWhenReady(join(fixture, 'descendant-pid')));
      expect(Number.isSafeInteger(childPid)).toBe(true);
      expect(childPid).toBeGreaterThan(1);
      await cleanup?.();
      expect(await readWhenReady(join(fixture, 'descendant-terminated'))).toBe(
        'yes',
      );
      expect(await running).toBeInstanceOf(Error);
      childPid = undefined;
    } finally {
      await cleanup?.();
      if (childPid) killFixtureChild(childPid);
      if (previousCache === undefined) delete process.env.OPENGREP_CACHE_DIR;
      else process.env.OPENGREP_CACHE_DIR = previousCache;
      await rm(directory, { recursive: true, force: true });
    }
  },
  10000,
);
