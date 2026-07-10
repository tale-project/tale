/**
 * CI guard for the versioned data-migration framework. Fails the build when a
 * migration on disk is misconfigured, so a half-wired migration can never
 * merge. Run via `bun run migrations:check`.
 *
 * The heavy lifting lives in ./migrations-codegen.ts, which derives every
 * migration's identity from its folder path and regenerates the registries.
 * Check mode verifies, for every `convex/migrations/versions/<vX_Y_Z>/<NN_slug>/`:
 *
 *   1. Folder shape — name formats, exactly one of meta.ts+index.ts (legacy)
 *      or migration.ts (define shape), a sibling migration.test.ts.
 *   2. Identity — legacy meta agrees with the folder-derived id/semver/
 *      numericId/slug; reversible:true; destructive runnable ⇒ snapshot.
 *   3. Uniqueness/ordering — global id + orderKey uniqueness, NN contiguity
 *      per version folder, 'use node' directive ⟺ node kind.
 *   4. Registry drift — registry.gen.ts / registry.node.gen.ts byte-match a
 *      fresh regeneration (`bun run migrations:sync` refreshes them).
 *   5. Meta parity — during the define-API port, ALL_META must stay
 *      byte-identical to convex/migrations/meta.parity.json.
 *   6. _id-FK safety — a runnable db migration with snapshot 'table-rows'
 *      must not target a table referenced by `v.id(...)` anywhere in the
 *      schema (restore mints fresh _ids; references would dangle).
 *
 * Pure static check — no Convex backend required.
 */

import schema from '../convex/schema';
import {
  checkTableRowsFkSafety,
  runMigrationsCodegen,
} from './migrations-codegen';

function liveSchemaExportJson(): string {
  // `SchemaDefinition.export()` is Convex's canonical JSON of every table. It
  // is a runtime method not surfaced in the public type, so reach it via
  // Reflect (same access as check-schema-snapshot.ts).
  const exportFn = Reflect.get(schema, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error(
      'convex schema has no export() method — convex API changed?',
    );
  }
  const exported: unknown = exportFn.call(schema);
  if (typeof exported !== 'string') {
    throw new Error('schema.export() did not return a JSON string.');
  }
  return exported;
}

async function main(): Promise<void> {
  const result = await runMigrationsCodegen({ write: false });
  const errors = [...result.errors];

  if (result.migrations.length > 0) {
    errors.push(
      ...checkTableRowsFkSafety(result.migrations, liveSchemaExportJson()),
    );
  }

  if (errors.length > 0) {
    console.error('[check-migrations] FAILED:\n  - ' + errors.join('\n  - '));
    process.exit(1);
  }
  console.log(
    `[check-migrations] OK — ${result.migrations.length} migration folder(s), registries current.`,
  );
}

void main();
