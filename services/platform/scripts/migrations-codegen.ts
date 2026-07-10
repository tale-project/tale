/**
 * Registry codegen + structural validation for the versioned data-migration
 * framework. The folder tree under `convex/migrations/versions/` is the source
 * of truth; this tool derives every migration's identity from its path and
 * regenerates the two registries the runner consumes:
 *
 *   framework/registry.gen.ts       (V8)         ALL_META + requireMeta +
 *                                                DB_MIGRATIONS + COMPONENT_MIGRATIONS
 *   framework/registry.node.gen.ts  ('use node') NODE_MIGRATIONS
 *
 * Meta is emitted as inline literals — the V8 registry never imports a
 * `'use node'` handler module. Drift is impossible to ship: check mode
 * (`bun run migrations:check`, via check-migrations.ts) regenerates both files
 * in memory and byte-compares against the committed copies, exactly like
 * `bun run skills:check`. The `.gen.ts` (two-dot) basenames keep the files out
 * of the Convex function address space — the same bundler rule that excludes
 * `migration.test.ts` from the push (registry.node.ts relied on it already).
 *
 * Every folder is define-shape: one `migration.ts` exporting
 * `define<Kind>Migration({ … })`; meta derives from the folder name. The
 * legacy `meta.ts` + `index.ts` shape is a hard error.
 *
 * Modes:
 *   bun scripts/migrations-codegen.ts --write      # regenerate (migrations:sync)
 *   bun scripts/migrations-codegen.ts              # check: report drift
 *   bun scripts/migrations-codegen.ts --dump-meta  # canonical ALL_META JSON
 *
 * Import-time note: this tool imports every migration module under bun
 * (serially, with the folder named on failure), so module scope must stay
 * side-effect-free — the same constraint vitest already imposes on them.
 */

import {
  existsSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type {
  AnyMigrationModule,
  MigrationSubjects,
} from '../convex/migrations/framework/define';
import {
  buildOrderKey,
  parseSemver,
} from '../convex/migrations/framework/semver';
import type {
  MigrationKind,
  MigrationMeta,
} from '../convex/migrations/framework/types';

const here = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_ROOT = path.join(here, '../convex/migrations');
const VERSIONS_DIR = path.join(MIGRATIONS_ROOT, 'versions');

export const REGISTRY_GEN_PATH = path.join(
  MIGRATIONS_ROOT,
  'framework/registry.gen.ts',
);
export const NODE_REGISTRY_GEN_PATH = path.join(
  MIGRATIONS_ROOT,
  'framework/registry.node.gen.ts',
);

const VERSION_DIR_RE = /^v(\d+)_(\d+)_(\d+)$/;
const FOLDER_RE = /^(\d{2})_([a-z0-9_]+)$/;
const KINDS: ReadonlySet<MigrationKind> = new Set([
  'db',
  'node',
  'component',
  'reference',
]);

export interface DiscoveredMigration {
  /** `v0_2_85/01_governance_db_to_json` — folder path relative to versions/. */
  readonly rel: string;
  readonly dir: string;
  readonly semver: string;
  readonly numericId: number;
  readonly slug: string;
  readonly id: string;
  readonly orderKey: string;
  readonly kind: MigrationKind;
  readonly meta: MigrationMeta;
  /** Declared by the define shape only; consumed by the corpus guard. */
  readonly subjects?: MigrationSubjects;
  /** The paginated table (db/reference kinds); drives the _id-FK guard. */
  readonly table?: string;
}

export interface CodegenFile {
  readonly path: string;
  readonly content: string;
  readonly upToDate: boolean;
}

export interface CodegenResult {
  readonly errors: string[];
  /** Ordered by orderKey. Empty when discovery-level errors occurred. */
  readonly migrations: DiscoveredMigration[];
  readonly files: CodegenFile[];
}

// ---------------------------------------------------------------------------
// Discovery + module loading
// ---------------------------------------------------------------------------

function hasUseNodeDirective(source: string): boolean {
  const withoutLeadingComments = source.replace(
    /^(\s*(\/\/[^\n]*\n|\/\*[\s\S]*?\*\/))*\s*/,
    '',
  );
  return /^['"]use node['"];?/.test(withoutLeadingComments);
}

function isMigrationModule(value: unknown): value is AnyMigrationModule {
  if (typeof value !== 'object' || value === null) return false;
  const m = value as Record<string, unknown>;
  return (
    KINDS.has(m.kind as MigrationKind) &&
    typeof m.spec === 'object' &&
    m.spec !== null
  );
}

async function loadFolder(
  versionDir: string,
  folderName: string,
  semver: string,
  errors: string[],
): Promise<DiscoveredMigration | null> {
  const rel = `${path.basename(versionDir)}/${folderName}`;
  const dir = path.join(versionDir, folderName);

  const folderMatch = FOLDER_RE.exec(folderName);
  if (!folderMatch) {
    errors.push(
      `${rel}: folder name must match NN_snake_slug (two digits, lowercase).`,
    );
    return null;
  }
  const numericId = Number.parseInt(folderMatch[1], 10);
  const slug = folderMatch[2];
  const id = `${semver}/${folderName}`;

  const definePath = path.join(dir, 'migration.ts');
  if (
    existsSync(path.join(dir, 'meta.ts')) ||
    existsSync(path.join(dir, 'index.ts'))
  ) {
    errors.push(
      `${rel}: the legacy meta.ts/index.ts shape was removed — export const migration = define<Kind>Migration({...}) in migration.ts (bun run gen:migration scaffolds it).`,
    );
    return null;
  }
  if (!existsSync(definePath)) {
    errors.push(`${rel}: no migration.ts (define shape).`);
    return null;
  }

  const testPath = path.join(dir, 'migration.test.ts');
  if (!existsSync(testPath)) {
    errors.push(`${rel}: no sibling migration.test.ts (up/down round-trip).`);
  }

  {
    let mod: Record<string, unknown>;
    try {
      mod = (await import(definePath)) as Record<string, unknown>;
    } catch (err) {
      errors.push(
        `${rel}/migration.ts failed to import: ${err instanceof Error ? err.message : String(err)}`,
      );
      return null;
    }
    const migration = mod.migration;
    if (!isMigrationModule(migration)) {
      errors.push(
        `${rel}/migration.ts must \`export const migration = define<Kind>Migration({ … })\`.`,
      );
      return null;
    }
    const useNode = hasUseNodeDirective(readFileSync(definePath, 'utf-8'));
    if (migration.kind === 'node' && !useNode) {
      errors.push(
        `${rel}/migration.ts defines a node migration but is missing the leading 'use node' directive.`,
      );
    }
    if (migration.kind !== 'node' && useNode) {
      errors.push(
        `${rel}/migration.ts declares 'use node' but defines a ${migration.kind} migration — the V8 registry could not import it.`,
      );
    }
    const spec = migration.spec as {
      title: string;
      description: string;
      destructive: boolean;
      snapshot: MigrationMeta['snapshot'];
      subjects?: MigrationSubjects;
      table?: string;
    };
    // Runnable db/node tests must ride the declarative harness (component
    // tests are hand-written until a sanctioned user-seeding support fn
    // exists; reference tests call the handlers directly by design).
    if (
      (migration.kind === 'db' || migration.kind === 'node') &&
      existsSync(testPath) &&
      !readFileSync(testPath, 'utf-8').includes('defineMigrationTest(')
    ) {
      errors.push(
        `${rel}/migration.test.ts must use defineMigrationTest (testing/harness.testkit.ts) — the harness carries the up/idempotency/down-digest ritual.`,
      );
    }
    const meta: MigrationMeta = {
      id,
      semver,
      numericId,
      slug,
      title: spec.title,
      description: spec.description,
      kind: migration.kind,
      reversible: true,
      destructive: spec.destructive,
      snapshot: spec.snapshot,
    };
    return {
      rel,
      dir,
      semver,
      numericId,
      slug,
      id,
      orderKey: buildOrderKey(semver, numericId),
      kind: migration.kind,
      meta,
      subjects: spec.subjects,
      table: spec.table,
    };
  }
}

export async function discoverMigrations(
  errors: string[],
): Promise<DiscoveredMigration[]> {
  const out: DiscoveredMigration[] = [];
  if (!existsSync(VERSIONS_DIR)) {
    errors.push(`versions directory missing: ${VERSIONS_DIR}`);
    return out;
  }
  for (const versionName of readdirSync(VERSIONS_DIR).sort()) {
    const versionDir = path.join(VERSIONS_DIR, versionName);
    if (!statSync(versionDir).isDirectory()) continue;
    const match = VERSION_DIR_RE.exec(versionName);
    if (!match) {
      errors.push(
        `versions/${versionName}: version folder must match v<major>_<minor>_<patch>.`,
      );
      continue;
    }
    const semver = `${match[1]}.${match[2]}.${match[3]}`;
    try {
      parseSemver(semver);
    } catch (err) {
      errors.push(
        `versions/${versionName}: ${err instanceof Error ? err.message : String(err)}`,
      );
      continue;
    }
    for (const entry of readdirSync(versionDir).sort()) {
      const folder = path.join(versionDir, entry);
      if (!statSync(folder).isDirectory()) continue;
      const loaded = await loadFolder(versionDir, entry, semver, errors);
      if (loaded) out.push(loaded);
    }
  }
  out.sort((a, b) => a.orderKey.localeCompare(b.orderKey));
  return out;
}

// ---------------------------------------------------------------------------
// Cross-migration validation
// ---------------------------------------------------------------------------

export function validateSet(
  migrations: DiscoveredMigration[],
  errors: string[],
): void {
  const byId = new Map<string, DiscoveredMigration>();
  for (const m of migrations) {
    const dup = byId.get(m.id);
    if (dup) {
      errors.push(
        `duplicate migration id "${m.id}" (${dup.rel} and ${m.rel}).`,
      );
    }
    byId.set(m.id, m);
  }

  // orderKey uniqueness — the defect class behind the v0_2_90 collision.
  const byOrderKey = new Map<string, DiscoveredMigration>();
  for (const m of migrations) {
    const dup = byOrderKey.get(m.orderKey);
    if (dup && dup.id !== m.id) {
      errors.push(
        `orderKey collision between ${dup.rel} and ${m.rel} — numericId must be unique per version.`,
      );
    }
    byOrderKey.set(m.orderKey, m);
  }

  // NN contiguity per version folder: 01..N with no gaps.
  const byVersion = new Map<string, number[]>();
  for (const m of migrations) {
    const list = byVersion.get(m.semver) ?? [];
    list.push(m.numericId);
    byVersion.set(m.semver, list);
  }
  for (const [semver, ids] of byVersion) {
    const sorted = [...ids].sort((a, b) => a - b);
    for (let i = 0; i < sorted.length; i++) {
      if (sorted[i] !== i + 1) {
        errors.push(
          `version ${semver}: numericIds must run 01..${String(sorted.length).padStart(2, '0')} contiguously (found ${sorted
            .map((n) => String(n).padStart(2, '0'))
            .join(', ')}).`,
        );
        break;
      }
    }
  }
}

/**
 * `table-rows` restore re-inserts rows with FRESH `_id`s
 * (runner.restoreSnapshotBatch), so a rolled-back table whose `_id` is a
 * foreign key elsewhere would leave dangling references. Fail any runnable db
 * migration that snapshots a `v.id(...)`-referenced table.
 *
 * Limitation: Better Auth component rows reference each other via plain
 * string fields, invisible to this walk — component `table-rows` migrations
 * stay on author judgment.
 */
export function checkTableRowsFkSafety(
  migrations: DiscoveredMigration[],
  schemaExportJson: string,
): string[] {
  const errors: string[] = [];
  const parsed = JSON.parse(schemaExportJson) as {
    tables?: Array<{ tableName: string; documentType?: unknown }>;
  };

  // tableName -> the "refTable.path" sites that v.id() it.
  const referencedBy = new Map<string, string[]>();
  const walk = (node: unknown, refTable: string, trail: string): void => {
    if (Array.isArray(node)) {
      for (const item of node) walk(item, refTable, trail);
      return;
    }
    if (typeof node !== 'object' || node === null) return;
    const rec = node as Record<string, unknown>;
    if (rec.type === 'id' && typeof rec.tableName === 'string') {
      const sites = referencedBy.get(rec.tableName) ?? [];
      sites.push(`${refTable}${trail ? `.${trail}` : ''}`);
      referencedBy.set(rec.tableName, sites);
      return;
    }
    for (const [key, value] of Object.entries(rec)) {
      const nextTrail =
        key === 'value' || key === 'fieldType' || key === 'keys'
          ? trail
          : trail
            ? `${trail}.${key}`
            : key;
      walk(value, refTable, nextTrail);
    }
  };
  for (const table of parsed.tables ?? []) {
    walk(table.documentType, table.tableName, '');
  }

  for (const m of migrations) {
    if (m.kind !== 'db' || m.meta.snapshot !== 'table-rows') continue;
    if (!m.table) continue; // load error already reported by discovery
    const sites = referencedBy.get(m.table);
    if (sites && sites.length > 0) {
      errors.push(
        `${m.rel}: snapshot 'table-rows' on "${m.table}", but its _id is referenced by v.id() at ${sites.join(', ')} — restore mints fresh _ids and would dangle these references. Use a non-destructive expand/contract instead.`,
      );
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

function varName(m: DiscoveredMigration): string {
  const v = m.semver.replace(/\./g, '_');
  const nn = String(m.numericId).padStart(2, '0');
  return `${m.kind === 'node' ? 'n' : 'm'}${v}_${nn}`;
}

function importPath(m: DiscoveredMigration): string {
  return `../versions/${m.rel}/migration`;
}

function metaLiteral(meta: MigrationMeta, indent: string): string {
  const lines = [
    `id: ${JSON.stringify(meta.id)},`,
    `semver: ${JSON.stringify(meta.semver)},`,
    `numericId: ${meta.numericId},`,
    `slug: ${JSON.stringify(meta.slug)},`,
    `title: ${JSON.stringify(meta.title)},`,
    `description: ${JSON.stringify(meta.description)},`,
    `kind: '${meta.kind}',`,
    `reversible: true,`,
    `destructive: ${meta.destructive},`,
    `snapshot: '${meta.snapshot}',`,
  ];
  return `{\n${lines.map((l) => `${indent}  ${l}`).join('\n')}\n${indent}}`;
}

const GEN_HEADER = `// GENERATED by \`bun run migrations:sync\` — DO NOT EDIT.
// Derived from the folder tree under convex/migrations/versions/;
// \`bun run migrations:check\` regenerates this file in memory and fails on
// any byte drift. The two-dot basename keeps it out of the Convex function
// address space (same bundler rule that excludes migration.test.ts).`;

export function generateRegistry(migrations: DiscoveredMigration[]): string {
  const db = migrations.filter((m) => m.kind === 'db');
  const component = migrations.filter((m) => m.kind === 'component');

  const composeImports = new Set<string>();
  if (db.length > 0) composeImports.add('composeDb');
  if (component.length > 0) composeImports.add('composeComponent');

  const lines: string[] = [GEN_HEADER];
  lines.push(
    '//',
    '// V8-safe: node/reference migrations contribute inline meta literals only —',
    "// their handler modules ('use node' / test-only) are never imported here.",
    '',
  );
  if (composeImports.size > 0) {
    lines.push(
      `import { ${[...composeImports].sort().join(', ')} } from './compose';`,
    );
  }
  lines.push(
    "import type { ComponentMigration, DbMigration, MigrationMeta } from './types';",
  );
  for (const m of [...db, ...component]) {
    lines.push(
      `import { migration as ${varName(m)} } from '${importPath(m)}';`,
    );
  }

  lines.push(
    '',
    '/** Every migration’s metadata, ordered by (semver, numericId). */',
    'export const ALL_META: readonly MigrationMeta[] = [',
  );
  for (const m of migrations) {
    lines.push(`  ${metaLiteral(m.meta, '  ')},`);
  }
  lines.push(
    '];',
    '',
    'const BY_ID: ReadonlyMap<string, MigrationMeta> = new Map(',
    '  ALL_META.map((m) => [m.id, m]),',
    ');',
    '',
    "/** Look up a migration's meta by its stable id; throws on an unknown id. */",
    'export function requireMeta(id: string): MigrationMeta {',
    '  const meta = BY_ID.get(id);',
    '  if (!meta) throw new Error(`Unknown migration id: ${id}`);',
    '  return meta;',
    '}',
    '',
    '/** Runnable `db` migrations, keyed by meta.id. */',
    'export const DB_MIGRATIONS: Readonly<Record<string, DbMigration>> = {',
  );
  for (const m of db) {
    lines.push(
      `  ${JSON.stringify(m.id)}: composeDb(requireMeta(${JSON.stringify(m.id)}), ${varName(m)}),`,
    );
  }
  lines.push(
    '};',
    '',
    '/** Runnable `component` migrations, keyed by meta.id. */',
    'export const COMPONENT_MIGRATIONS: Readonly<',
    '  Record<string, ComponentMigration>',
    '> = {',
  );
  for (const m of component) {
    lines.push(
      `  ${JSON.stringify(m.id)}: composeComponent(requireMeta(${JSON.stringify(m.id)}), ${varName(m)}),`,
    );
  }
  lines.push('};', '');
  return lines.join('\n');
}

export function generateNodeRegistry(
  migrations: DiscoveredMigration[],
): string {
  const node = migrations.filter((m) => m.kind === 'node');

  const helperImports = new Set<string>();
  if (node.length > 0) helperImports.add('composeNode');

  const lines: string[] = [
    "'use node';",
    '',
    GEN_HEADER,
    '//',
    "// Node-migration handler registry: 'use node' handler modules composed",
    '// with their derived meta. Only the node runner imports this.',
    '',
  ];
  if (helperImports.size > 0) {
    lines.push(
      `import { ${[...helperImports].sort().join(', ')} } from './node_helpers';`,
    );
  }
  if (node.length > 0) {
    lines.push("import { requireMeta } from './registry.gen';");
  }
  lines.push("import type { NodeMigration } from './types';");
  for (const m of node) {
    lines.push(
      `import { migration as ${varName(m)} } from '${importPath(m)}';`,
    );
  }
  lines.push(
    '',
    '/** Runnable `node` migrations, keyed by meta.id. */',
    'export const NODE_MIGRATIONS: Readonly<Record<string, NodeMigration>> = {',
  );
  for (const m of node) {
    lines.push(
      `  ${JSON.stringify(m.id)}: composeNode(requireMeta(${JSON.stringify(m.id)}), ${varName(m)}),`,
    );
  }
  lines.push('};', '');
  return lines.join('\n');
}

/** Canonical ALL_META JSON (audit/debugging dumps). */
export function dumpMeta(migrations: DiscoveredMigration[]): string {
  return `${JSON.stringify(
    migrations.map((m) => m.meta),
    null,
    2,
  )}\n`;
}

// ---------------------------------------------------------------------------
// _generated/api.d.ts maintenance
// ---------------------------------------------------------------------------

const API_DTS_PATH = path.join(here, '../convex/_generated/api.d.ts');

/**
 * Every single-dot .ts module under versions/ — folder handlers/metas plus
 * the version-shared helper modules (legacy_governance.ts, …). Mirrors what
 * `convex codegen` lists; two-dot files (tests, testkits) are bundler-skipped
 * and never appear.
 */
function versionsModuleRels(): string[] {
  const out: string[] = [];
  const walk = (dir: string, rel: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = path.join(dir, entry);
      const childRel = rel ? `${rel}/${entry}` : entry;
      if (statSync(full).isDirectory()) {
        walk(full, childRel);
      } else if (
        entry.endsWith('.ts') &&
        entry.split('.').length === 2 // single-dot: a pushed Convex module
      ) {
        out.push(`migrations/versions/${childRel.slice(0, -3)}`);
      }
    }
  };
  if (existsSync(VERSIONS_DIR)) walk(VERSIONS_DIR, '');
  return out.sort();
}

function apiAliasOf(moduleRel: string): string {
  return moduleRel.replaceAll('/', '_').replaceAll('.', '_');
}

/**
 * Rewrite api.d.ts's `migrations/versions/**` import + module-map sections to
 * match the file tree. `skipLibCheck` makes a stale entry FAIL SILENTLY — the
 * unresolved `import type` degrades the whole generated api to `any` and
 * typecheck explodes far away in app/ code — so this must stay in lockstep
 * with every port. Convex's own `codegen` produces the identical section but
 * needs a running backend; this keeps the committed file true without one.
 */
export function rewriteApiDts(content: string): string {
  const moduleRels = versionsModuleRels();

  const importLine = (rel: string): string =>
    `import type * as ${apiAliasOf(rel)} from "../${rel}.js";`;
  const mapLine = (rel: string): string =>
    `  "${rel}": typeof ${apiAliasOf(rel)};`;

  const lines = content.split('\n');
  const isVersionsImport = (l: string): boolean =>
    l.startsWith('import type * as migrations_versions_');
  const isVersionsMapEntry = (l: string): boolean =>
    l.startsWith('  "migrations/versions/');

  const firstImport = lines.findIndex(isVersionsImport);
  const firstMap = lines.findIndex(isVersionsMapEntry);
  if (firstImport < 0 || firstMap < 0) {
    throw new Error(
      'api.d.ts has no migrations/versions section — regenerate it with `bunx convex codegen` once, then re-run migrations:sync.',
    );
  }

  const withoutOld = lines.filter(
    (l) => !isVersionsImport(l) && !isVersionsMapEntry(l),
  );
  // Recompute anchors on the filtered array (same predicate targets removed
  // contiguous blocks; the anchor is where the first removed line sat).
  let importAnchor = 0;
  let mapAnchor = 0;
  {
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      if (i === firstImport) importAnchor = seen;
      if (i === firstMap) mapAnchor = seen;
      if (!isVersionsImport(lines[i]) && !isVersionsMapEntry(lines[i])) seen++;
    }
  }

  withoutOld.splice(importAnchor, 0, ...moduleRels.map(importLine));
  const mapInsertAt =
    mapAnchor + (mapAnchor >= importAnchor ? moduleRels.length : 0);
  withoutOld.splice(mapInsertAt, 0, ...moduleRels.map(mapLine));
  return withoutOld.join('\n');
}

// ---------------------------------------------------------------------------
// Entry
// ---------------------------------------------------------------------------

export interface CodegenOptions {
  readonly write: boolean;
}

export async function runMigrationsCodegen(
  opts: CodegenOptions,
): Promise<CodegenResult> {
  const errors: string[] = [];
  const migrations = await discoverMigrations(errors);
  validateSet(migrations, errors);

  const files: CodegenFile[] = [];
  if (errors.length === 0) {
    const targets: Array<[string, string]> = [
      [REGISTRY_GEN_PATH, generateRegistry(migrations)],
      [NODE_REGISTRY_GEN_PATH, generateNodeRegistry(migrations)],
      [API_DTS_PATH, rewriteApiDts(readFileSync(API_DTS_PATH, 'utf-8'))],
    ];
    for (const [filePath, content] of targets) {
      const existing = existsSync(filePath)
        ? readFileSync(filePath, 'utf-8')
        : null;
      const upToDate = existing === content;
      if (!upToDate) {
        if (opts.write) {
          writeFileSync(filePath, content);
        } else {
          errors.push(
            `${path.relative(path.join(here, '..'), filePath)} is out of date — run \`bun run --filter @tale/platform migrations:sync\`.`,
          );
        }
      }
      files.push({ path: filePath, content, upToDate });
    }
  }

  return { errors, migrations, files };
}

async function main(): Promise<void> {
  const write = process.argv.includes('--write');
  const dump = process.argv.includes('--dump-meta');

  if (dump) {
    const errors: string[] = [];
    const migrations = await discoverMigrations(errors);
    validateSet(migrations, errors);
    if (errors.length > 0) {
      console.error(
        '[migrations-codegen] FAILED:\n  - ' + errors.join('\n  - '),
      );
      process.exit(1);
    }
    process.stdout.write(dumpMeta(migrations));
    return;
  }

  const result = await runMigrationsCodegen({ write });
  if (result.errors.length > 0) {
    console.error(
      '[migrations-codegen] FAILED:\n  - ' + result.errors.join('\n  - '),
    );
    process.exit(1);
  }
  const changed = result.files.filter((f) => !f.upToDate).length;
  console.log(
    write
      ? `[migrations-codegen] OK — ${result.migrations.length} migration(s), ${changed} file(s) ${changed > 0 ? 'regenerated' : 'already current'}.`
      : `[migrations-codegen] OK — ${result.migrations.length} migration(s), registries current.`,
  );
}

if (import.meta.main) {
  void main();
}
