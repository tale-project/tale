// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';
import { z } from 'zod';

/**
 * CI's **Backend integration** check runs `backend:integration` on a pull
 * request only when the change touches a path in the `integration` filter of
 * the **Integration scope** job (`.github/workflows/checks.yml`). A file the
 * suite runs but the filter misses lets a pull request that changes only that
 * file merge without the proof. The filter first shipped missing three: the
 * backend's telemetry imports `services/platform/sla-targets.ts`, and its
 * HTTP error page two `@tale/ui` i18n modules.
 *
 * This walks the harness's module graph from `backend/integration-check.ts`:
 * every static import and re-export, every dynamic `import()` of a literal,
 * resolved the way the platform's `tsconfig.json` resolves them (workspace
 * packages through their `exports`), stopping at `node_modules`. It also
 * takes the files and directories the graph reads through
 * `new URL('<path>', import.meta.url)` — the migrations, the notification
 * catalogs under `messages/`. Each must fall under a filter entry.
 *
 * The walk reads `@tale/shared`'s and `@tale/ui`'s sources to follow their
 * imports. `packages/ui/src` is a declared input of this task already; a
 * change to `packages/shared` alone does not re-run this guard (the `^` gap
 * `.agents/repo.md` records), but such a pull request owes the proof itself,
 * since the filter lists `packages/shared/**`.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const REPO_ROOT = path.resolve(PLATFORM_ROOT, '../..');
const HARNESS = path.join(PLATFORM_ROOT, 'backend/integration-check.ts');

function toRepoPath(absolute: string): string {
  return path.relative(REPO_ROOT, absolute).split(path.sep).join('/');
}

/** The slice of `checks.yml` this guard reads. */
const checksSchema = z.object({
  jobs: z.object({
    'integration-scope': z.object({
      steps: z.array(
        z.object({
          id: z.string().optional(),
          with: z.record(z.string(), z.unknown()).optional(),
        }),
      ),
    }),
  }),
});

/** The `integration` filter's entries, in file order. */
function integrationFilter(): string[] {
  const checks = checksSchema.parse(
    parse(
      readFileSync(
        path.join(REPO_ROOT, '.github/workflows/checks.yml'),
        'utf8',
      ),
    ),
  );
  const step = checks.jobs['integration-scope'].steps.find(
    (candidate) => candidate.id === 'filter',
  );
  const filters = z
    .object({ integration: z.array(z.string()) })
    .parse(parse(z.string().parse(step?.with?.filters)));
  return filters.integration;
}

/**
 * Whether `repoPath` falls under an entry. The guard reads two shapes only,
 * so its answer is exactly `dorny/paths-filter`'s: a literal path, and
 * `<directory>/**` for everything under a directory.
 */
function covers(entries: readonly string[], repoPath: string): boolean {
  return entries.some((entry) =>
    entry.endsWith('/**')
      ? repoPath.startsWith(entry.slice(0, -2))
      : repoPath === entry,
  );
}

const compilerConfigurations = new Set<string>();
const compilerOptions = (() => {
  const parsed = ts.getParsedCommandLineOfConfigFile(
    path.join(PLATFORM_ROOT, 'tsconfig.json'),
    {},
    {
      ...ts.sys,
      readFile: (file) => {
        const configuration = path.resolve(file);
        if (
          configuration.startsWith(REPO_ROOT + path.sep) &&
          !configuration.split(path.sep).includes('node_modules')
        ) {
          compilerConfigurations.add(toRepoPath(configuration));
        }
        return ts.sys.readFile(file);
      },
      onUnRecoverableConfigFileDiagnostic: (diagnostic) => {
        throw new Error(
          ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'),
        );
      },
    },
  );
  if (!parsed) throw new Error('services/platform/tsconfig.json did not parse');
  return parsed.options;
})();

/**
 * `new URL('<path>', import.meta.url)`: a file a module reads. The path is
 * the literal up to its first `${`; `built` says the name goes on from there.
 */
const URL_READ =
  /new URL\(\s*['"`](?<path>[^'"`$]*)(?<built>\$\{)?[^)]*?import\.meta\.url/g;

/**
 * What one `new URL` read covers, as a repo path: the file a literal names,
 * or, for a name built at run time (or a directory), the directory it
 * sits in as `<directory>/**`.
 */
function urlRead(file: string, literal: string, built: boolean): string {
  const target = path.resolve(path.dirname(file), literal);
  if (!built && !literal.endsWith('/')) return toRepoPath(target);
  const directory = literal.endsWith('/') ? target : path.dirname(target);
  return `${toRepoPath(directory)}/**`;
}

/**
 * The harness's module graph, as repo paths: every module it runs, every
 * file its `new URL` reads name, and the directory of every read whose name
 * is built at run time (`${directory}/**` then covers it). Also the
 * relative imports that did not resolve, which would make the walk blind.
 */
function harnessGraph(): { reads: Set<string>; unresolved: string[] } {
  const modules = new Set<string>();
  const reads = new Set<string>();
  const unresolved: string[] = [];
  const queue = [HARNESS];
  while (queue.length > 0) {
    const file = queue.pop();
    if (file === undefined || modules.has(file)) continue;
    modules.add(file);
    reads.add(toRepoPath(file));
    const source = readFileSync(file, 'utf8');
    for (const { fileName } of ts.preProcessFile(source, true, true)
      .importedFiles) {
      const resolved = ts.resolveModuleName(
        fileName,
        file,
        compilerOptions,
        ts.sys,
      ).resolvedModule?.resolvedFileName;
      if (resolved === undefined) {
        // A package the runtime installs, or a `node:` builtin.
        if (fileName.startsWith('.')) unresolved.push(`${file}: ${fileName}`);
        continue;
      }
      if (
        resolved.split(path.sep).includes('node_modules') ||
        /\.d\.[cm]?ts$/.test(resolved) ||
        !resolved.startsWith(REPO_ROOT + path.sep)
      ) {
        continue;
      }
      queue.push(resolved);
    }
    for (const match of source.matchAll(URL_READ)) {
      const literal = match.groups?.path ?? '';
      if (literal === '') continue;
      reads.add(urlRead(file, literal, match.groups?.built !== undefined));
    }
  }
  return { reads, unresolved };
}

/** What the harness reads and no entry covers. */
function uncovered(
  entries: readonly string[],
  reads: ReadonlySet<string>,
): string[] {
  return [...reads]
    .filter((read) =>
      read.endsWith('/**')
        ? !covers(entries, `${read.slice(0, -2)}x`)
        : !covers(entries, read),
    )
    .sort();
}

describe('the Integration scope filter', () => {
  const entries = integrationFilter();
  const graph = harnessGraph();

  it('lists only literal paths and whole directories', () => {
    const shapeless = entries.filter((entry) =>
      /[*?[\]{}!]/.test(entry.endsWith('/**') ? entry.slice(0, -3) : entry),
    );
    expect(
      shapeless,
      'use a literal path or `<directory>/**`, the two shapes this guard reads',
    ).toEqual([]);
  });

  it('covers every root TypeScript config family', () => {
    const configs = readdirSync(REPO_ROOT, { withFileTypes: true })
      .filter(
        (entry) =>
          entry.isFile() &&
          entry.name.startsWith('tsconfig') &&
          entry.name.endsWith('.json'),
      )
      .map((entry) => entry.name)
      .sort();
    expect(configs.length).toBeGreaterThan(0);
    expect(
      configs.filter((config) => !covers(entries, config)),
      'add every root config family to the Integration scope filter',
    ).toEqual([]);
    for (const config of configs) {
      expect(
        uncovered(
          entries.filter((entry) => !covers([entry], config)),
          new Set(configs),
        ),
        config,
      ).toContain(config);
    }
  });

  it('covers the compiler configurations actually extended', () => {
    expect(compilerConfigurations).toContain('services/platform/tsconfig.json');
    expect(uncovered(entries, compilerConfigurations)).toEqual([]);
    for (const config of compilerConfigurations) {
      expect(
        uncovered(
          entries.filter((entry) => !covers([entry], config)),
          compilerConfigurations,
        ),
        config,
      ).toContain(config);
    }
  });

  it('walks the whole harness', () => {
    expect(graph.unresolved).toEqual([]);
    // Far past the harness and its helpers: through the backend, into
    // `lib/` and the workspace packages.
    expect(graph.reads.size).toBeGreaterThan(500);
    for (const reached of [
      'services/platform/backend/integration-lane-helpers.ts',
      'services/platform/backend/db/migrate.ts',
      'services/platform/backend/db/migrations/**',
      'services/sandbox-runtime/daemon/src/file-ops.ts',
      'services/sandbox-runtime/daemon/src/protocol.ts',
    ]) {
      expect(graph.reads, reached).toContain(reached);
    }
    expect(
      [...graph.reads].some((read) => read.startsWith('packages/shared/')),
      'the walk reaches @tale/shared',
    ).toBe(true);
  });

  it('covers every module the suite runs and every file it reads', () => {
    expect(
      uncovered(entries, graph.reads),
      'add each to the `integration` filter in .github/workflows/checks.yml',
    ).toEqual([]);
  });

  it('names what an entry it lost would leave out', () => {
    expect(
      uncovered(
        entries.filter((entry) => entry !== 'services/platform/backend/**'),
        graph.reads,
      ),
    ).toContain('services/platform/backend/integration-check.ts');
  });
});
