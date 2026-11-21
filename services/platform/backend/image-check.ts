/**
 * What an image must hold for its backend to do its work, checked from inside
 * the image with the backend's own code:
 *
 *   docker exec <container> node /app/backend-dist/image-check.js
 *
 * The backend reads four things from beside its code, and a boot that misses
 * one of them does not fail: the PII data tree only logs (every document
 * under a `pii_config` policy is then refused), a message catalog falls back
 * to the key, and the code runner fails the first automation that evaluates
 * an expression. So a packaging mistake surfaces as a customer's problem
 * days later. This reads each of them the way the running backend does and
 * exits 1 with the reason when one is missing.
 *
 * Built by `scripts/build-backend.ts` as an entry of its own; it shares the
 * build's chunks, so it tests the files the backend itself loads.
 */

import { readdirSync } from 'node:fs';

import { nodeVmRunner } from '../lib/engine/runners/node-vm.ts';
import { PatternRegistry } from '../lib/pii/index.ts';
import { messageCatalog } from './core/i18n/catalog.ts';
import {
  BUILT,
  builtMigrationName,
  MIGRATIONS_DIR,
  migrationFileOnDisk,
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

/** Each check under the name a failure is reported by: the build minifies
 * function names, so the name is written out. */
const CHECKS: [name: string, check: () => Promise<string>][] = [
  ['the PII data tree', piiDataTree],
  ['the message catalogs', messageCatalogs],
  ['the boot migrations', bootMigrations],
  ['the code runner', codeRunner],
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
