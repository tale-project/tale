import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { beforeAll, describe, expect, it } from 'vitest';

import { README_PATTERN, REPO_ROOT } from './lib/paths';
import { walkDocs } from './lib/walk';

/**
 * Turbo keys a task's cache on the files of its own workspace, and neither the
 * content tree (`docs/`), the root READMEs nor `@tale/ui`'s i18n framework
 * belong to this one — so a task that reads them replays its last verdict when
 * only they change, and a broken page passes CI (a docs-only edit replayed
 * `@tale/docs:test` from the cache). `services/docs/turbo.json` declares them
 * as `$TURBO_ROOT$` inputs; this asks turbo itself (`--dry=json`) which files
 * each task hashes, so an input list that misses a file the task reads fails
 * here instead of replaying green.
 *
 * A task that starts reading another file outside `services/docs/` lists it
 * in `turbo.json` and here. (`@tale/cli`'s tests read the CLI install pages;
 * `tools/cli/src/lib/config/platform-docs.test.ts` guards that reader.)
 */

const DATA_FILES = ['docs/nav.json', 'docs/redirects.json'];

/** The ledger of published addresses: the published suite reads it, the
 *  build (`scripts/build-search-index.ts`) appends new pages to it. */
const LEDGER = 'docs/published.json';

/**
 * The documentation frame's link, redirect and near-miss rules in `@tale/ui`:
 * the link, published and near-miss suites run them, the build scripts
 * (search index, prerender) expand redirects and record published slugs.
 */
const UI_DOCS_RULES = [
  'packages/ui/src/components/docs/links.ts',
  'packages/ui/src/components/docs/near-miss.ts',
  'packages/ui/src/components/docs/published.ts',
  'packages/ui/src/components/docs/redirects.ts',
  'packages/ui/src/markdown/heading-id.ts',
];
const UI_DOCS_BUILD_RULES = [
  'packages/ui/src/components/docs/published.ts',
  'packages/ui/src/components/docs/redirects.ts',
];

/** `@tale/ui`'s i18n folder, repo-relative. */
const UI_I18N = 'packages/ui/src/i18n';

/** Every file under a repo-relative directory, repo-relative and `/`-separated. */
function filesUnder(dir: string): string[] {
  const root = path.join(REPO_ROOT, dir);
  return fs
    .readdirSync(root, { recursive: true, encoding: 'utf8' })
    .filter((entry) => fs.statSync(path.join(root, entry)).isFile())
    .map((entry) => toPosix(path.join(dir, entry)));
}

/**
 * What the i18n suites load from `@tale/ui`: `lib/i18n/messages.test.ts`
 * resolves the service's `docs.*` keys against the package catalogs
 * (`packageCatalogs`), and it and `docs.test.ts` run the shared framework
 * (`@tale/ui/i18n/tests` — its checks, per-locale rule data and glossary).
 */
function uiI18nFiles(): string[] {
  const catalogs = filesUnder(`${UI_I18N}/messages`).filter((file) =>
    file.endsWith('.yml'),
  );
  const framework = filesUnder(`${UI_I18N}/tests`).filter(
    (file) => !/\.test\.tsx?$/.test(file),
  );
  return [
    ...catalogs,
    ...filesUnder('packages/marketing-ui/src/i18n/messages').filter((file) =>
      file.endsWith('.yml'),
    ),
    ...framework,
  ];
}

/** Every page the structural suite walks, plus the nav and redirect maps. */
function contentFiles(): string[] {
  return [
    ...walkDocs().map((page) => toPosix(path.join('docs', page))),
    ...DATA_FILES,
    LEDGER,
  ];
}

/** The root READMEs `readme.test.ts` compares. */
function rootReadmes(): string[] {
  return fs.readdirSync(REPO_ROOT).filter((name) => README_PATTERN.test(name));
}

const READERS: { task: string; why: string; reads: () => string[] }[] = [
  {
    task: 'test',
    why: 'the structural, link and published suites, the i18n suites and the README parity check',
    reads: () => [
      ...contentFiles(),
      ...rootReadmes(),
      ...uiI18nFiles(),
      ...UI_DOCS_RULES,
    ],
  },
  {
    task: 'build',
    why: 'the bundled pages, search index, published ledger and prerender (`test:prerender` depends on it)',
    reads: () => [...contentFiles(), ...UI_DOCS_BUILD_RULES],
  },
  {
    task: 'test:prerender',
    why: 'the built-site crawl (`@tale/e2e/crawl`)',
    reads: () => ['packages/e2e/src/crawl.ts'],
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
  if (run.error) {
    throw new Error(`turbo --dry=json did not run: ${run.error.message}`, {
      cause: run.error,
    });
  }
  if (run.status !== 0) {
    throw new Error(`turbo --dry=json exited ${run.status}: ${run.stderr}`);
  }
  const start = run.stdout.indexOf('{');
  if (start === -1) {
    throw new Error(`turbo --dry=json printed no JSON: ${run.stdout}`);
  }
  const { tasks } = JSON.parse(run.stdout.slice(start)) as {
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

  it('every input list keeps the root task inputs and the workspace sources', () => {
    // A workspace `inputs` list replaces the root task's instead of adding to
    // it; `$TURBO_EXTENDS$` keeps the root's, `$TURBO_DEFAULT$` the workspace's
    // own files.
    const { tasks } = JSON.parse(
      fs.readFileSync(path.join(REPO_ROOT, 'services/docs/turbo.json'), 'utf8'),
    ) as { tasks: Record<string, { inputs?: string[] }> };
    const lists = Object.entries(tasks).filter(([, { inputs }]) => inputs);
    expect(
      lists.length,
      'services/docs/turbo.json declares no task inputs',
    ).toBeGreaterThan(0);
    for (const [task, { inputs }] of lists) {
      expect(inputs?.slice(0, 2), `services/docs/turbo.json ${task}`).toEqual([
        '$TURBO_EXTENDS$',
        '$TURBO_DEFAULT$',
      ]);
    }
  });

  for (const { task, why, reads } of READERS) {
    it(`@tale/docs#${task} hashes every file it reads outside the workspace`, () => {
      const inputs = hashed.get(`@tale/docs#${task}`) ?? new Set<string>();
      // `$TURBO_DEFAULT$` stays in the list, or the task's own sources drop out.
      // Probe this file: turbo hashes `package.json` and `turbo.json` either way.
      const self = toPosix(
        path.relative(REPO_ROOT, fileURLToPath(import.meta.url)),
      );
      expect(inputs.has(self), `@tale/docs#${task} does not hash ${self}`).toBe(
        true,
      );
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
