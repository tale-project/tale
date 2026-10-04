import assert from 'node:assert/strict';
import { constants } from 'node:fs';
import {
  access,
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
} from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

import type { Workload } from './workloads';

export async function prepareToolWorkload(
  id: 'tools.plop-scaffold' | 'tools.opengrep',
  root: string,
  fixtureRoot: string,
): Promise<Workload> {
  let activeChild: Bun.Subprocess<'ignore', 'pipe', 'pipe'> | undefined;
  let activeCompletion: Promise<[string, string, number]> | undefined;
  let childPeakRssBytes = 0;
  const runChild = async (command: string[], cwd: string) => {
    const child = Bun.spawn(command, {
      cwd,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      // Opengrep's launcher forks an interpreter and scanner engine. Give
      // this workload its own group so interruption also reaches those children.
      detached: process.platform !== 'win32',
      env: {
        ...process.env,
        PYTHONUTF8: '1',
        PYTHONIOENCODING: 'utf-8',
      },
    });
    activeChild = child;
    const completion = Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ]);
    activeCompletion = completion;
    try {
      const [stdout, stderr, exitCode] = await completion;
      childPeakRssBytes = Math.max(
        childPeakRssBytes,
        child.resourceUsage()?.maxRSS ?? 0,
      );
      assert.equal(exitCode, 0, stderr.slice(-2000));
      return stdout;
    } finally {
      activeChild = undefined;
      activeCompletion = undefined;
    }
  };
  const cleanup = async () => {
    const child = activeChild;
    const completion = activeCompletion;
    if (!child) return;
    const signal = (value: NodeJS.Signals) => {
      try {
        process.kill(
          process.platform === 'win32' ? child.pid : -child.pid,
          value,
        );
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ESRCH') throw error;
      }
    };
    signal('SIGTERM');
    const deadline = setTimeout(() => signal('SIGKILL'), 1000);
    try {
      // Draining also waits for descendants holding the inherited pipes open.
      await completion;
    } finally {
      clearTimeout(deadline);
      // A descendant may close its pipes while continuing to run.
      signal('SIGKILL');
      await child.exited;
    }
  };

  if (id === 'tools.plop-scaffold') {
    return {
      operations: 1,
      unit: 'scaffolds',
      description:
        'Fresh Plop CLI process scaffolds and verifies one TypeScript package in a disposable destination; includes directory creation and cleanup',
      async run() {
        const directory = await mkdtemp(join(fixtureRoot, 'scaffold-'));
        try {
          await runChild(
            [
              process.execPath,
              resolve(root, 'node_modules/plop/bin/plop.js'),
              '--plopfile',
              resolve(root, 'tools/plop/plopfile.ts'),
              '--dest',
              directory,
              'package',
              'performance-probe',
              'Synthetic performance fixture',
              'typescript',
              'false',
            ],
            directory,
          );
          const output = join(directory, 'packages/performance-probe');
          const manifest = JSON.parse(
            await readFile(join(output, 'package.json'), 'utf8'),
          ) as { name: string };
          assert.equal(manifest.name, '@tale/performance-probe');
          assert.ok((await readdir(output)).includes('src'));
          assert.ok(
            (await readFile(join(output, 'tests/smoke.test.ts'), 'utf8'))
              .length > 0,
          );
        } finally {
          await rm(directory, { recursive: true, force: true });
        }
      },
      details: () => ({ childPeakRssBytes }),
      cleanup,
    };
  }

  // Reuse the gate's version and cache location without invoking its downloader.
  const runner = await readFile(resolve(root, 'tools/opengrep/run.sh'), 'utf8');
  const version = /^OPENGREP_VERSION="([^"]+)"$/m.exec(runner)?.[1];
  assert.ok(version, 'Cannot resolve the repository Opengrep version pin');
  const cache =
    process.env.OPENGREP_CACHE_DIR ||
    join(process.env.XDG_CACHE_HOME || join(homedir(), '.cache'), 'opengrep');
  const binary = resolve(cache, version, 'opengrep');
  try {
    await access(binary, constants.X_OK);
  } catch {
    throw new Error(
      `Pinned Opengrep ${version} is not cached; run bun run lint:sast to install it before selecting tools.opengrep`,
    );
  }
  const files = 10;
  const source = Array.from(
    { length: 200 },
    (_, i) =>
      `export function square${i}(value: number) { return value * value; }`,
  ).join('\n');
  for (let i = 0; i < files; i++) {
    await writeFile(
      join(fixtureRoot, `probe-${i}.ts`),
      `${source}\n${i === 0 ? 'eval("synthetic scanner finding");' : ''}\n`,
    );
  }
  return {
    operations: files,
    unit: 'files',
    description:
      'Fresh pinned Opengrep process scans ten synthetic TypeScript files with repository-local rules; verifies one intentional finding, excludes full registry/repository scan',
    async run() {
      const stdout = await runChild(
        [
          binary,
          'scan',
          '--config',
          resolve(root, 'tools/opengrep/config.yml'),
          '--json',
          '--quiet',
          '--disable-version-check',
          '--jobs=1',
          '--no-git-ignore',
          fixtureRoot,
        ],
        fixtureRoot,
      );
      const result = JSON.parse(stdout) as {
        version: string;
        results: { check_id: string }[];
        errors: unknown[];
        paths: { scanned: string[] };
      };
      assert.equal(result.version, version.slice(1));
      assert.deepEqual(result.errors, []);
      assert.equal(result.paths.scanned.length, files);
      assert.equal(result.results.length, 1);
      assert.ok(result.results[0]?.check_id.endsWith('ts-no-eval'));
    },
    details: () => ({
      version,
      childPeakRssBytes,
      memoryScope:
        'OS-reported scanner child usage; may include reaped engine descendants. Not aggregate concurrent process-tree RSS.',
    }),
    cleanup,
  };
}
