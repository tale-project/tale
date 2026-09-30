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
 * the platform depends on (`@tale/shared`, `@tale/e2e`) are not outside
 * reads in this sense when a suite only imports them: turbo would need a `^`
 * dependency to hash those, which `.agents/repo.md` records as a gap of its
 * own. A suite that reads a package's files as text is an outside read like
 * any other: the accent palette's test reads `@tale/ui`'s stylesheet, and
 * the error-message guard all of `packages/ui/src`.
 *
 * `@tale/ui` is the exception to that gap. The component suites (`test:ui`
 * in jsdom, `test:browser` in Chromium) render its components, stylesheet
 * and catalogs, and the automation editor's browser suite imports its test
 * helpers (`@tale/ui/testing/flow`), so a design-system change alone must
 * re-run them: both hash `packages/ui/src` whole, as `test` does. All three
 * tasks also hash the package's manifest and every file it exports from
 * outside `src/` (`UI_PACKAGE_FILES`).
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
  {
    // The Integration scope job's path filter, held to the harness's imports.
    path: '.github/workflows/checks.yml',
    readers: 'tests/guards/integration-scope.guard.test.ts',
  },
  { path: 'compose.yml', readers: 'scripts/dev-sandbox-runtime.test.ts' },
  { path: 'compose.dev.yml', readers: 'scripts/dev-secrets.test.ts' },
  {
    path: 'configs/platform/custom',
    readers:
      'backend/core/provisioning/provision_default_automations.test.ts and lib/shared/config/document-skills-catalog.test.ts',
  },
  {
    path: 'configs/platform/system',
    readers:
      'the shipped connector, model, provider, harness and PII catalog suites',
  },
  {
    // The connector guides, which table the catalog the picker offers and
    // name the connectors whose credentials carry an instance URL.
    path: 'docs/*/platform/admin/connectors.md',
    readers: 'backend/core/connector_credentials/catalog_docs.test.ts',
  },
  {
    path: 'docs/*/platform/connectors/overview.md',
    readers: 'backend/core/connector_credentials/catalog_docs.test.ts',
  },
  {
    // The user docs' task page, which states the task caps in each locale.
    path: 'docs/*/platform/projects/tasks.md',
    readers: 'backend/core/tasks/limits_docs.test.ts',
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
    // Read as text too: every toast and Alert text the design system builds.
    path: 'packages/ui/src',
    readers: 'tests/guards/error-message-description.guard.test.ts',
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
    // Run under /bin/sh, not imported: the setup token the gateway image
    // hands the gateway, paired with the platform's own bootstrap.
    path: 'services/sandbox-llm-gateway/docker-entrypoint.sh',
    readers: 'backend/core/node_only/sandbox/gateway_setup_token.test.ts',
  },
  {
    // Its engine install RUN, run under /bin/sh with recording doubles.
    path: 'services/sandbox-runtime/Dockerfile',
    readers: 'tests/guards/dockerfile-fail-closed.guard.test.ts',
  },
  {
    path: 'services/sandbox/src/config.ts',
    readers: 'scripts/dev-sandbox-runtime.test.ts',
  },
];

/** The slice of `packages/ui/package.json` this guard reads. */
const uiManifestSchema = z.object({
  exports: z.record(z.string(), z.unknown()),
});

/** Every path an `exports` value names: a string, or conditions around one. */
function exportTargets(value: unknown): string[] {
  if (typeof value === 'string') return [value];
  if (typeof value === 'object' && value !== null)
    return Object.values(value).flatMap(exportTargets);
  return [];
}

/**
 * The `@tale/ui` files outside `packages/ui/src` that `test`, `test:ui` and
 * `test:browser` all hash beside it, read from the package's manifest so an
 * export added outside `src/` cannot go unhashed: the manifest itself, whose
 * `exports` resolve every `@tale/ui/*` import (both vitest configs load
 * `@tale/ui/vite/yaml`, and the suites import `@tale/ui/testing/flow` among
 * others, so an export renamed or dropped breaks them with no file under
 * `src/` changed), and every file an export names outside `src/`.
 */
const UI_PACKAGE_FILES = [
  {
    path: 'packages/ui/package.json',
    why: 'its `exports` resolve every `@tale/ui/*` import',
  },
  ...Object.entries(
    uiManifestSchema.parse(
      JSON.parse(
        readFileSync(path.join(REPO_ROOT, 'packages/ui/package.json'), 'utf8'),
      ),
    ).exports,
  ).flatMap(([name, value]) =>
    exportTargets(value)
      .filter((target) => !target.startsWith('./src/'))
      .map((target) => ({
        path: path.posix.join('packages/ui', target),
        why: `the \`${name}\` export`,
      })),
  ),
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

/** Repo-relative files turbo hashes for `@tale/platform#<name>`. */
function hashedBy(name: string): Set<string> {
  const stdout = run('bunx', [
    'turbo',
    'run',
    name,
    '--filter=@tale/platform',
    '--dry=json',
    '--cache=local:,remote:',
  ]);
  const { tasks } = dryRunSchema.parse(
    JSON.parse(stdout.slice(stdout.indexOf('{'))),
  );
  const taskId = `@tale/platform#${name}`;
  const task = tasks.find((entry) => entry.taskId === taskId);
  if (!task) throw new Error(`turbo --dry=json listed no ${taskId}`);
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

/** A case per `UI_PACKAGE_FILES` entry, against what `hashed()` lists for `name`. */
function itHashesUiPackageFiles(name: string, hashed: () => Set<string>) {
  for (const { path: repoPath, why } of UI_PACKAGE_FILES) {
    it(`hashes ${repoPath} (${why})`, () => {
      // A path, or the pattern of a wildcard export.
      const files = trackedFiles(repoPath);
      expect(files.length, `${repoPath} tracks no file`).toBeGreaterThan(0);
      const missing = files.filter((file) => !hashed().has(file));
      expect(
        missing.slice(0, 10),
        `@tale/platform#${name} does not hash ${missing.length} file(s) at ${repoPath} — list \`$TURBO_ROOT$/${repoPath}\` in services/platform/turbo.json tasks.${name}.inputs`,
      ).toEqual([]);
    });
  }
}

describe('@tale/platform#test turbo inputs', () => {
  let hashed: Set<string>;

  beforeAll(() => {
    hashed = hashedBy('test');
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
    expect(
      lists.length,
      'services/platform/turbo.json declares no task inputs',
    ).toBeGreaterThan(0);
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

  itHashesUiPackageFiles('test', () => hashed);
});

/** The tasks that run the component suites, which render `@tale/ui`. */
const COMPONENT_TASKS = ['test:ui', 'test:browser'];

describe.each(COMPONENT_TASKS)('@tale/platform#%s turbo inputs', (name) => {
  let hashed: Set<string>;

  beforeAll(() => {
    hashed = hashedBy(name);
  }, 60_000);

  it('still hashes its own workspace', () => {
    const self = toRepoPath(fileURLToPath(import.meta.url));
    expect(
      hashed.has(self),
      `@tale/platform#${name} does not hash ${self}`,
    ).toBe(true);
  });

  it('hashes packages/ui/src, the design system its suites render', () => {
    const files = trackedFiles('packages/ui/src');
    expect(files.length, 'packages/ui/src tracks no file').toBeGreaterThan(0);
    const missing = files.filter((file) => !hashed.has(file));
    expect(
      missing.slice(0, 10),
      `@tale/platform#${name} renders ${missing.length} @tale/ui file(s) that turbo does not hash — list \`$TURBO_ROOT$/packages/ui/src/**\` in services/platform/turbo.json tasks.${name}.inputs`,
    ).toEqual([]);
  });

  itHashesUiPackageFiles(name, () => hashed);
});
