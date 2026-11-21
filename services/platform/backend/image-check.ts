/**
 * What an image must hold for its backend to do its work, checked from inside
 * the image with the backend's own code:
 *
 *   docker exec <container> node /app/backend-dist/image-check.js
 *
 * `--app <directory>` names the built app to judge in place of the image's
 * own (`dist/` beside the backend), for a tree that keeps it elsewhere.
 *
 * The backend reads five things from beside its code, and a boot that misses
 * one of them does not fail: the PII data tree only logs (every document
 * under a `pii_config` policy is then refused), a message catalog falls back
 * to the key, the code runner fails the first automation that evaluates an
 * expression, and the heavy slot fails the first file that is indexed. So a
 * packaging mistake surfaces as a customer's problem days later. This reads each of them the way the running backend does and
 * exits 1 with the reason when one is missing. It also says what the build
 * was built as: one made for anything but production runs every library's
 * development checks and never says so either. And it says whether the app
 * the same process serves was compressed at build: without that every page
 * still loads, and the edge compresses each bundle per request, which is
 * where its memory goes.
 *
 * Built by `scripts/build-backend.ts` as an entry of its own; it shares the
 * build's chunks, so it tests the files the backend itself loads.
 */

import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { nodeVmRunner } from '../lib/engine/runners/node-vm.ts';
import { PatternRegistry } from '../lib/pii/index.ts';
import { messageCatalog } from './core/i18n/catalog.ts';
import { extractInHeavySlot } from './lib/heavy-slot/documents.ts';
import {
  BUILT,
  builtMigrationName,
  MIGRATIONS_DIR,
  migrationFileOnDisk,
  PLATFORM_ROOT,
} from './lib/layout.ts';

/** The locales the catalog ships a whole topic set for. */
const FULL_CATALOG_LOCALES = ['en', 'de', 'fr'];

async function piiDataTree(): Promise<string> {
  PatternRegistry.fromDefaults();
  return 'the PII data tree loads';
}

async function messageCatalogs(): Promise<string> {
  for (const locale of FULL_CATALOG_LOCALES) {
    const topics = Object.keys(messageCatalog(locale));
    if (topics.length === 0)
      throw new Error(`the ${locale} message catalog has no topic`);
  }
  return `the message catalogs load (${FULL_CATALOG_LOCALES.join(', ')})`;
}

async function bootMigrations(): Promise<string> {
  const files = readdirSync(MIGRATIONS_DIR);
  const names = BUILT
    ? files
        .map(builtMigrationName)
        .filter((name): name is string => name !== null)
    : files;
  const data = names.filter(
    (name) => name.endsWith('.ts') && !name.endsWith('.test.ts'),
  );
  const sql = names.filter((name) => name.endsWith('.sql'));
  if (sql.length === 0) throw new Error('no .sql boot migration found');
  for (const name of data) {
    const module: unknown = await import(
      new URL(migrationFileOnDisk(name), MIGRATIONS_DIR).href
    );
    if (
      typeof module !== 'object' ||
      module === null ||
      !('migrate' in module) ||
      typeof module.migrate !== 'function'
    )
      throw new Error(`data migration ${name} does not export migrate(tx)`);
  }
  return `the boot migrations are readable (${sql.length} SQL, ${data.length} data)`;
}

async function codeRunner(): Promise<string> {
  const runner = nodeVmRunner({ processes: 1 });
  // The runner never keeps its host alive on its own: its child and its
  // pipes are unref'd until the child reports ready. A child that cannot
  // start would let this program run out of work before its exit is told,
  // so a timer holds the event loop until the evaluation settles.
  const hold = setInterval(() => undefined, 1_000);
  try {
    const value = await runner.runBody(
      'return left + right',
      { left: 20, right: 22 },
      { timeoutMs: 10_000 },
    );
    if (value !== 42)
      throw new Error(`the code runner answered ${JSON.stringify(value)}`);
  } finally {
    clearInterval(hold);
  }
  return 'the code runner evaluates in its child process';
}

/** A document read by the heavy slot's child: the program is there, it
 * starts under its heap limit, and what it reads comes back. */
async function heavySlot(): Promise<string> {
  const sentence =
    'The heavy slot reads this sentence in a process of its own.';
  const read = await extractInHeavySlot(
    { kind: 'bytes', bytes: new TextEncoder().encode(sentence) },
    'image-check.txt',
    { priority: 'interactive', signal: AbortSignal.timeout(30_000) },
  );
  if (read.text !== sentence)
    throw new Error(`the heavy slot read ${JSON.stringify(read.text)}`);
  return 'the heavy slot reads a document in its child process';
}

/**
 * The build writes NODE_ENV into the code in place of every read of it
 * (`scripts/build-backend.ts`), so what this reads is what every module of
 * the build was given, whatever the container's environment says.
 */
async function productionBuild(): Promise<string> {
  if (!BUILT) return 'the backend runs from its sources';
  const mode = process.env.NODE_ENV;
  if (mode !== 'production')
    throw new Error(
      `the backend was built with NODE_ENV=${mode ?? '(unset)'}, not production`,
    );
  return 'the backend is a production build';
}

/** The size below which the build writes no neighbour
 *  (`MIN_BYTES` in scripts/precompress-dist.ts). */
const PRECOMPRESSED_FROM_BYTES = 1024;

/**
 * The app's bundles and their precompressed neighbours, as the web tier
 * finds them (`lib/static-file.ts`): every script and stylesheet of a
 * kilobyte or more has a `.br` and a `.gz` beside it. Both codings shrink
 * any such file, so a missing one means the build step did not run.
 */
async function precompressedApp(): Promise<string> {
  const named = process.argv.indexOf('--app');
  const dist =
    named === -1
      ? fileURLToPath(new URL('dist', PLATFORM_ROOT))
      : process.argv[named + 1];
  if (dist === undefined) throw new Error('--app names no directory');
  const assets = join(dist, 'assets');
  let names: string[];
  try {
    names = readdirSync(assets);
  } catch (error) {
    // A checkout whose app was never built has nothing to say here.
    if (!BUILT && named === -1) return 'the app is not built here';
    throw new Error(`the built app has no assets directory at ${assets}`, {
      cause: error,
    });
  }
  const present = new Set(names);
  const bundles = names.filter(
    (name) =>
      (name.endsWith('.js') || name.endsWith('.css')) &&
      statSync(join(assets, name)).size >= PRECOMPRESSED_FROM_BYTES,
  );
  if (bundles.length === 0)
    throw new Error('the built app has no script or stylesheet');
  const bare = bundles.filter(
    (name) => !present.has(`${name}.br`) || !present.has(`${name}.gz`),
  );
  if (bare.length > 0)
    throw new Error(
      `bundles of the app without a precompressed neighbour: ${bare.length} of ${bundles.length} in ${assets}, ${bare[0]} for one. scripts/precompress-dist.ts writes them at build; without them the edge compresses each bundle per request`,
    );
  return `the app's bundles are precompressed (${bundles.length}, brotli and gzip)`;
}

/** Each check under the name a failure is reported by: the build minifies
 * function names, so the name is written out. */
const CHECKS: [name: string, check: () => Promise<string>][] = [
  ['the build', productionBuild],
  ['the built app', precompressedApp],
  ['the PII data tree', piiDataTree],
  ['the message catalogs', messageCatalogs],
  ['the boot migrations', bootMigrations],
  ['the code runner', codeRunner],
  ['the heavy slot', heavySlot],
];

let failed = false;
for (const [name, check] of CHECKS) {
  try {
    console.log(`ok    ${await check()}`);
  } catch (error) {
    failed = true;
    console.error(`FAIL  ${name}:`, error);
  }
}
// The code runner's child keeps no handle open, but a failed start may.
process.exit(failed ? 1 : 0);
