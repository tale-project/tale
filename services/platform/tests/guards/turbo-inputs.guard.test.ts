// @vitest-environment node

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { findRepoSystemConfigRoot } from '../../lib/shared/config/system-root';
import { ENSURE_SANDBOX_RUNTIME_SCRIPT } from '../../scripts/dev-sandbox-runtime';

/**
 * Turbo keys the `test` task's cache on the files of this workspace, so a
 * suite that reads a file outside `services/platform/` replays its last
 * verdict when only that file changes — a PR that edits nothing but a
 * shipped `connector.yml` would pass CI without the catalog tests running.
 * `services/platform/turbo.json` lists every such file as a `$TURBO_ROOT$`
 * input; this asks turbo itself (`--dry=json`) which files the task hashes,
 * so an input list that drops one fails here instead of replaying green.
 *
 * Every input list opens with `$TURBO_EXTENDS$` (the root task's inputs,
 * which a workspace list otherwise replaces) and `$TURBO_DEFAULT$` (this
 * workspace's own files). The root `test` task declares no inputs yet, so
 * the dry run hashes the same files without `$TURBO_EXTENDS$`; the guard
 * reads that prefix from `turbo.json` itself.
 *
 * A suite that starts reading another file outside the workspace adds it to
 * `turbo.json` and to `OUTSIDE_READS`. The sources of the workspace packages
 * the platform depends on (`@tale/ui`, `@tale/shared`, `@tale/e2e`) are not
 * outside reads in this sense: turbo would need a `^` dependency to hash them,
 * which `.agents/repo.md` records as a gap of its own.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');

function toRepoPath(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/** Every repo path outside the workspace the `test` task reads, and who reads it. */
const OUTSIDE_READS = [
  {
    path: '.env.example',
    readers: 'tests/guards/env-example-scope.guard.test.ts',
  },
  { path: 'compose.yml', readers: 'scripts/dev-sandbox-runtime.test.ts' },
  { path: 'compose.dev.yml', readers: 'scripts/dev-secrets.test.ts' },
  {
    path: 'configs/platform/custom',
    readers: 'backend/core/provisioning/provision_default_automations.test.ts',
  },
  {
    path: 'configs/platform/system',
    readers:
      'the shipped connector, model, provider, harness and PII catalog suites',
  },
  {
    path: 'knip.config.ts',
    readers: 'tests/guards/frontend-entry-discovery.guard.test.ts',
  },
  {
    // Read as text, not imported: the guard that holds the accent palette's
    // `THEME_BACKGROUND` to the stylesheet's `--background`.
    path: 'packages/ui/src/globals.css',
    readers: 'lib/utils/color.test.ts',
  },
  {
    path: ENSURE_SANDBOX_RUNTIME_SCRIPT,
    readers: 'scripts/dev-sandbox-runtime.test.ts',
  },
  {
    path: 'services/db/init-scripts',
    readers: 'tests/guards/db-init-scripts.guard.test.ts',
  },
  {
    path: 'services/db/migrations/knowledge-db',
    readers: 'backend/core/knowledge/ddl.test.ts',
  },
  {
    path: 'services/sandbox/src/config.ts',
    readers: 'scripts/dev-sandbox-runtime.test.ts',
  },
];

/** The slice of `turbo run --dry=json` this guard reads. */
const dryRunSchema = z.object({
  tasks: z.array(
    z.object({
      taskId: z.string(),
      directory: z.string(),
      inputs: z.record(z.string(), z.string()),
    }),
  ),
});

/** The slice of `services/platform/turbo.json` this guard reads. */
const turboJsonSchema = z.object({
  tasks: z.record(
    z.string(),
    z.object({ inputs: z.array(z.string()).optional() }),
  ),
});

function run(command: string, args: string[]): string {
  const result = spawnSync(command, args, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(' ')} exited ${result.status}: ${result.stderr}`,
    );
  }
  return result.stdout;
}

/** Repo-relative files turbo hashes for `@tale/platform#test`. */
function hashedByTest(): Set<string> {
  const stdout = run('bunx', [
    'turbo',
    'run',
    'test',
    '--filter=@tale/platform',
    '--dry=json',
    '--cache=local:,remote:',
  ]);
  const { tasks } = dryRunSchema.parse(
    JSON.parse(stdout.slice(stdout.indexOf('{'))),
  );
  const task = tasks.find(({ taskId }) => taskId === '@tale/platform#test');
  if (!task) throw new Error('turbo --dry=json listed no @tale/platform#test');
  return new Set(
    Object.keys(task.inputs).map((file) =>
      toRepoPath(path.join(REPO_ROOT, task.directory, file)),
    ),
  );
}

/** The git-tracked files at `repoPath` — a file, or every file under a directory. */
function trackedFiles(repoPath: string): string[] {
  return run('git', ['ls-files', '-z', '--', repoPath])
    .split('\0')
    .filter(Boolean);
}

describe('@tale/platform#test turbo inputs', () => {
  let hashed: Set<string>;

  beforeAll(() => {
    hashed = hashedByTest();
  }, 60_000);

  it('still hashes its own workspace', () => {
    // `$TURBO_DEFAULT$` stays in the list, or the suite's own sources drop out.
    // Probe this file: turbo hashes `package.json` and `turbo.json` either way.
    const self = toRepoPath(fileURLToPath(import.meta.url));
    expect(hashed.has(self), `@tale/platform#test does not hash ${self}`).toBe(
      true,
    );
  });

  it('every input list keeps the root task inputs and the workspace sources', () => {
    const { tasks } = turboJsonSchema.parse(
      JSON.parse(readFileSync(path.join(PLATFORM_ROOT, 'turbo.json'), 'utf8')),
    );
    const lists = Object.entries(tasks).flatMap(([task, { inputs }]) =>
      inputs ? [{ task, inputs }] : [],
    );
    expect(lists.length).toBeGreaterThan(0);
    for (const { task, inputs } of lists) {
      expect(
        inputs.slice(0, 2),
        `services/platform/turbo.json tasks.${task}.inputs`,
      ).toEqual(['$TURBO_EXTENDS$', '$TURBO_DEFAULT$']);
    }
  });

  it('declares the system catalog where its readers find it', () => {
    const root = findRepoSystemConfigRoot(PLATFORM_ROOT);
    expect(root && toRepoPath(root)).toBe('configs/platform/system');
  });

  for (const { path: repoPath, readers } of OUTSIDE_READS) {
    it(`hashes ${repoPath} (${readers})`, () => {
      const files = trackedFiles(repoPath);
      // A path that no longer exists means the reader moved: follow it.
      expect(files.length, `${repoPath} tracks no file`).toBeGreaterThan(0);
      const missing = files.filter((file) => !hashed.has(file));
      expect(
        missing.slice(0, 10),
        `@tale/platform#test reads ${missing.length} file(s) under ${repoPath} that turbo does not hash — list them as \`$TURBO_ROOT$/…\` inputs in services/platform/turbo.json`,
      ).toEqual([]);
    });
  }
});
