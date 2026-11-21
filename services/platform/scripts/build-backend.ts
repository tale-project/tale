/**
 * Build the backend for production: one flat directory of JavaScript that
 * plain `node` runs, in place of the TypeScript sources read through the
 * type-transforming loader.
 *
 * Why: every source module the loader reads stays in memory as its own script
 * with its comments, and type transforming turns source maps on for all of
 * them. Built, the same process holds its code once, minified, and loads no
 * map (tale-project/tale#4942, findings 2 and 6).
 *
 * What it writes to `backend-dist/` (the shape `backend/lib/layout.ts` reads):
 *
 *   main.js                 the backend (`backend/main.ts`)
 *   node-vm-child.js        the code runner's child program
 *   image-check.js          checks the image holds what the backend reads
 *   symbolicate-trace.js    maps a logged stack trace back to the sources
 *   <name>.js               each data migration, compiled
 *   chunk-<hash>.js         code shared between entries, or loaded on demand
 *   <file>.js.map           each file's source map, read only by the program
 *                           above: nothing links to it, so node never loads it
 *   migrations/<name>.sql   the boot migrations, copied
 *   migrations/<name>.js    each data migration, by the name the migrator reads
 *   build.json              what was built, for the checks that read it
 *
 * Every dependency is inlined, so the directory runs without `node_modules`.
 *
 * Usage (from `services/platform`): `bun scripts/build-backend.ts [outdir]`
 */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join, resolve } from 'node:path';

import { isMigrationFile } from '@tale/shared/db/migration-files';

const PLATFORM_ROOT = resolve(import.meta.dirname, '..');
const MIGRATIONS_SOURCE = join(PLATFORM_ROOT, 'backend/db/migrations');

/** The backend's entry and the code runner's child program it forks, then the
 * two programs an operator runs from the image: the check of what the image
 * holds, and the one that reads a built stack trace back as source lines. */
const MAIN_ENTRY = 'backend/main.ts';
const CODE_RUNNER_CHILD_ENTRY = 'lib/engine/runners/node-vm-child.ts';
const IMAGE_CHECK_ENTRY = 'backend/image-check.ts';
const SYMBOLICATE_ENTRY = 'backend/symbolicate-trace.ts';

export interface BackendBuild {
  /** The directory the build was written to. */
  outdir: string;
  /** Entry files by the name the backend looks them up under. */
  entries: string[];
  /** Files of code shared between entries or loaded on demand. */
  chunks: number;
  /** `.sql` migrations copied beside the build. */
  sqlMigrations: number;
  /** Data migrations compiled into the build. */
  dataMigrations: string[];
  /** The size of every JavaScript file of the build, in bytes. */
  bytes: number;
}

const NODE_BUILTINS = new Set(builtinModules);

/**
 * The packages a built file still asks the runtime for. The build inlines
 * every dependency, so anything but a Node builtin here would be looked up in
 * a `node_modules` the image no longer ships. Parsed, not matched: minified
 * code is full of strings that read like imports.
 */
export function runtimeImports(source: string): string[] {
  const found = new Set<string>();
  for (const { path } of new Bun.Transpiler({ loader: 'js' }).scanImports(
    source,
  )) {
    if (path.startsWith('.') || path.startsWith('node:')) continue;
    if (!NODE_BUILTINS.has(path)) found.add(path);
  }
  return [...found].sort();
}

export async function buildBackend(outdir: string): Promise<BackendBuild> {
  rmSync(outdir, { recursive: true, force: true });
  const migrationFiles = readdirSync(MIGRATIONS_SOURCE)
    .filter(isMigrationFile)
    .sort();
  const dataMigrations = migrationFiles.filter((file) => file.endsWith('.ts'));

  const result = await Bun.build({
    entrypoints: [
      join(PLATFORM_ROOT, MAIN_ENTRY),
      join(PLATFORM_ROOT, CODE_RUNNER_CHILD_ENTRY),
      join(PLATFORM_ROOT, IMAGE_CHECK_ENTRY),
      join(PLATFORM_ROOT, SYMBOLICATE_ENTRY),
      ...dataMigrations.map((file) => join(MIGRATIONS_SOURCE, file)),
    ],
    outdir,
    target: 'node',
    format: 'esm',
    // One copy of the code the entries share, and a chunk per lazy import, so
    // what a boot never reaches (a PDF parser, a mail client) is never read.
    splitting: true,
    minify: true,
    // Beside each file and linked from none: a map the running process held
    // would cost what the build saves, so `symbolicate-trace.js` reads it
    // when a logged trace is mapped.
    sourcemap: 'external',
    // Flat: every built module sits in one directory, so a path worked out
    // from `import.meta.url` means the same wherever its code landed.
    naming: {
      entry: '[name].[ext]',
      chunk: 'chunk-[hash].[ext]',
      asset: 'asset-[hash].[ext]',
    },
  });
  if (!result.success) {
    throw new AggregateError(result.logs, 'the backend build failed');
  }

  const migrationsOut = join(outdir, 'migrations');
  mkdirSync(migrationsOut);
  for (const file of migrationFiles) {
    if (file.endsWith('.sql')) {
      copyFileSync(join(MIGRATIONS_SOURCE, file), join(migrationsOut, file));
      continue;
    }
    // The migrator lists one directory: a compiled data migration is reachable
    // there under its own name, and its code stays beside the chunks it shares.
    const compiled = `${file.slice(0, -'.ts'.length)}.js`;
    writeFileSync(
      join(migrationsOut, compiled),
      `export * from '../${compiled}';\n`,
    );
  }

  const outputs = result.outputs.filter((output) =>
    output.path.endsWith('.js'),
  );
  const build: BackendBuild = {
    outdir,
    entries: outputs
      .filter((output) => output.kind === 'entry-point')
      .map((output) => basename(output.path))
      .sort(),
    chunks: outputs.filter((output) => output.kind === 'chunk').length,
    sqlMigrations: migrationFiles.length - dataMigrations.length,
    dataMigrations,
    bytes: outputs.reduce(
      (total, output) => total + statSync(output.path).size,
      0,
    ),
  };

  const stray = new Map<string, string[]>();
  for (const output of outputs) {
    const packages = runtimeImports(await Bun.file(output.path).text());
    if (packages.length > 0) stray.set(basename(output.path), packages);
  }
  if (stray.size > 0) {
    const lines = [...stray].map(
      ([file, packages]) => `  ${file}: ${packages.join(', ')}`,
    );
    throw new Error(
      `the built backend still imports packages at runtime, which the image does not ship:\n${lines.join('\n')}`,
    );
  }

  writeFileSync(
    join(outdir, 'build.json'),
    `${JSON.stringify({ ...build, outdir: undefined }, null, 2)}\n`,
  );
  return build;
}

if (import.meta.main) {
  const outdir = resolve(
    PLATFORM_ROOT,
    process.argv[2] ?? join(PLATFORM_ROOT, 'backend-dist'),
  );
  const build = await buildBackend(outdir);
  console.log(
    `[build-backend] ${build.entries.length} entries, ${build.chunks} chunks, ${(build.bytes / 1024 ** 2).toFixed(1)} MiB of JavaScript, ${build.sqlMigrations} SQL and ${build.dataMigrations.length} data migrations → ${outdir}`,
  );
}
