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
 * Every script is written in one-byte characters (`one-byte-scripts.ts`), so
 * V8 holds its text at one byte a character and not two.
 *
 * Usage (from `services/platform`): `bun scripts/build-backend.ts [outdir]`
 */

import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { builtinModules } from 'node:module';
import { basename, join, resolve } from 'node:path';

import { isMigrationFile } from '@tale/shared/db/migration-files';

import {
  shiftGeneratedColumns,
  toOneByteScript,
  verifyShift,
  type GeneratedPosition,
} from './one-byte-scripts.ts';

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
  /**
   * What a boot reads before it does anything: `main.js` and every file it
   * imports statically, directly or through another. A file reached only by
   * an `import()` is read when that code first runs.
   */
  bootFiles: string[];
  /** The packages whose code is in those files, by name. */
  bootPackages: string[];
  /** UTF-16 units above U+00FF the build wrote as escapes. */
  escapedUnits: number;
}

const NODE_BUILTINS = new Set(builtinModules);

interface ScannedImport {
  path: string;
  kind: string;
}

function scanImports(source: string): ScannedImport[] {
  return new Bun.Transpiler({ loader: 'js' }).scanImports(source);
}

/**
 * The packages a built file still asks the runtime for. The build inlines
 * every dependency, so anything but a Node builtin here would be looked up in
 * a `node_modules` the image no longer ships. Parsed, not matched: minified
 * code is full of strings that read like imports.
 */
export function runtimeImports(source: string): string[] {
  const found = new Set<string>();
  for (const { path } of scanImports(source)) {
    if (path.startsWith('.') || path.startsWith('node:')) continue;
    if (!NODE_BUILTINS.has(path)) found.add(path);
  }
  return [...found].sort();
}

/** The package a source of a source map belongs to, or null for the
 * repository's own code: `../../../node_modules/@scope/name/x.js` is
 * `@scope/name`. */
export function packageOfSource(source: string): string | null {
  const segments = source.split('/');
  const at = segments.lastIndexOf('node_modules');
  const first = segments[at + 1];
  if (at === -1 || first === undefined) return null;
  const second = segments[at + 2];
  return first.startsWith('@') && second !== undefined
    ? `${first}/${second}`
    : first;
}

interface SourceMapFile {
  mappings: string;
  sources: string[];
}

function readSourceMap(path: string): SourceMapFile {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (
    typeof parsed !== 'object' ||
    parsed === null ||
    !('mappings' in parsed) ||
    typeof parsed.mappings !== 'string' ||
    !('sources' in parsed) ||
    !Array.isArray(parsed.sources)
  )
    throw new Error(`${path} is not a source map`);
  return {
    ...parsed,
    mappings: parsed.mappings,
    sources: parsed.sources.map(String),
  };
}

/**
 * Rewrite one built script in one-byte characters, and move its source map
 * along with it. Returns how many units were escaped.
 */
function writeOneByte(scriptPath: string): number {
  const original = readFileSync(scriptPath, 'utf8');
  const script = toOneByteScript(original);
  if (script.escaped === 0) return 0;
  const mapPath = `${scriptPath}.map`;
  const map = readSourceMap(mapPath);
  const positions: GeneratedPosition[] = [];
  const mappings = shiftGeneratedColumns(
    map.mappings,
    script.shifts,
    positions,
  );
  // Every mapped position is checked against the text before anything is
  // written: a map that drifted would symbolicate to the wrong line, quietly.
  verifyShift(original, script, positions);
  writeFileSync(scriptPath, script.text);
  writeFileSync(mapPath, JSON.stringify({ ...map, mappings }));
  return script.escaped;
}

/** `main.js` and every file it imports statically, directly or not. */
function bootFilesOf(outdir: string): string[] {
  const loaded = new Set(['main.js']);
  const queue = ['main.js'];
  for (let file = queue.pop(); file !== undefined; file = queue.pop()) {
    for (const { path, kind } of scanImports(
      readFileSync(join(outdir, file), 'utf8'),
    )) {
      if (kind === 'dynamic-import' || !path.startsWith('./')) continue;
      const imported = path.slice('./'.length);
      if (loaded.has(imported)) continue;
      loaded.add(imported);
      queue.push(imported);
    }
  }
  return [...loaded].sort();
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

  let escapedUnits = 0;
  const stray = new Map<string, string[]>();
  for (const output of outputs) {
    escapedUnits += writeOneByte(output.path);
    const packages = runtimeImports(readFileSync(output.path, 'utf8'));
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

  const bootFiles = bootFilesOf(outdir);
  const bootPackages = new Set<string>();
  for (const file of bootFiles) {
    for (const source of readSourceMap(join(outdir, `${file}.map`)).sources) {
      const name = packageOfSource(source);
      if (name !== null) bootPackages.add(name);
    }
  }

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
    bootFiles,
    bootPackages: [...bootPackages].sort(),
    escapedUnits,
  };

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
    `[build-backend] ${build.entries.length} entries, ${build.chunks} chunks, ${(build.bytes / 1024 ** 2).toFixed(1)} MiB of JavaScript (${build.bootFiles.length} files and ${build.bootPackages.length} packages read at boot), ${build.sqlMigrations} SQL and ${build.dataMigrations.length} data migrations → ${outdir}`,
  );
}
