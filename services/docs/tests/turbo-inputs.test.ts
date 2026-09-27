import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

import { beforeAll, describe, expect, it } from 'vitest';

import { README_PATTERN, REPO_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Turbo keys a task's cache on the files of its own workspace, and neither the
 * content tree (`docs/`) nor the root READMEs belong to one — so a task that
 * reads them replays its last verdict when only they change, and a broken
 * page passes CI (a docs-only edit replayed `@tale/docs:test` from the cache).
 * `services/docs/turbo.json` declares them as `$TURBO_ROOT$` inputs; this asks
 * turbo itself (`--dry=json`) which files each task hashes, so an input list
 * that misses a file the task reads fails here instead of replaying green.
 *
 * A task that starts reading another file outside `services/docs/` lists it
 * in `turbo.json` and here. (`@tale/cli`'s tests read the CLI install pages;
 * `tools/cli/src/lib/config/platform-docs.test.ts` guards that reader.)
 */

const DATA_FILES = ['docs/nav.json', 'docs/redirects.json'];

/** Every page the structural suite walks, plus the nav and redirect maps. */
function contentFiles(): string[] {
  return [
    ...walkDocs().map((page) => toPosix(path.join('docs', page))),
    ...DATA_FILES,
  ];
}

/** The root READMEs `readme.test.ts` compares. */
function rootReadmes(): string[] {
  return fs.readdirSync(REPO_ROOT).filter((name) => README_PATTERN.test(name));
}

const READERS: { task: string; why: string; reads: () => string[] }[] = [
  {
    task: 'test',
    why: 'the structural suite, the i18n docs scan and the README parity check',
    reads: () => [...contentFiles(), ...rootReadmes()],
  },
  {
    task: 'build',
    why: 'the bundled pages, search index and prerender (`test:prerender` depends on it)',
    reads: contentFiles,
  },
  {
    task: 'typecheck',
    why: '`lib/content/nav.ts` and `lib/redirects.ts` import the JSON maps',
    reads: () => DATA_FILES,
  },
  {
    task: 'lint',
    why: 'the type-aware rules see the same JSON imports',
    reads: () => DATA_FILES,
  },
];

function toPosix(file: string): string {
  return file.split(path.sep).join('/');
}

interface DryRunTask {
  taskId: string;
  directory: string;
  inputs: Record<string, string>;
}

/** Repo-relative files turbo hashes for each `@tale/docs` task. */
function hashedByTask(): Map<string, Set<string>> {
  const run = spawnSync(
    'bunx',
    [
      'turbo',
      'run',
      ...READERS.map(({ task }) => task),
      '--filter=@tale/docs',
      '--dry=json',
      '--cache=local:,remote:',
    ],
    { cwd: REPO_ROOT, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 },
  );
  if (run.status !== 0) {
    throw new Error(`turbo --dry=json exited ${run.status}: ${run.stderr}`);
  }
  const { tasks } = JSON.parse(run.stdout.slice(run.stdout.indexOf('{'))) as {
    tasks: DryRunTask[];
  };
  return new Map(
    tasks.map(({ taskId, directory, inputs }) => [
      taskId,
      new Set(
        Object.keys(inputs).map((file) =>
          toPosix(
            path.relative(REPO_ROOT, path.join(REPO_ROOT, directory, file)),
          ),
        ),
      ),
    ]),
  );
}

describe('turbo inputs', () => {
  let hashed: Map<string, Set<string>>;

  beforeAll(() => {
    hashed = hashedByTask();
  }, 60_000);

  for (const { task, why, reads } of READERS) {
    it(`@tale/docs#${task} hashes every file it reads outside the workspace`, () => {
      const inputs = hashed.get(`@tale/docs#${task}`) ?? new Set<string>();
      // `$TURBO_DEFAULT$` stays in the list, or the task's own sources drop out.
      expect(
        inputs.has('services/docs/package.json'),
        `@tale/docs#${task} no longer hashes its own workspace`,
      ).toBe(true);
      const files = reads();
      expect(files.length).toBeGreaterThan(0);
      const missing = files.filter((file) => !inputs.has(file));
      expect(
        missing.slice(0, 10),
        `@tale/docs#${task} reads ${missing.length} file(s) turbo does not hash (${why}) — list them as \`$TURBO_ROOT$/…\` inputs in services/docs/turbo.json`,
      ).toEqual([]);
    });
  }
});
