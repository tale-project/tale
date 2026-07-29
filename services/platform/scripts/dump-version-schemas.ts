/**
 * Per-version checkpoint generator: for every released version (each
 * `v0.2.x` / `v0.3.x` git tag) plus the in-development HEAD, produce THREE
 * ground-truth fixtures under `convex/migrations/testing/versions/`:
 *
 *   v<X_Y_Z>.db.schema.json     — the Convex DB schema fingerprint the release shipped
 *   v<X_Y_Z>.config.schema.json — the org-config (Zod → JSON Schema) fingerprint
 *   v<X_Y_Z>.scaffold.json      — what an INITIALIZED project of that era contains:
 *                                 the builtin-configs catalog as path → content-hash
 *                                 (unique contents once under versions/blobs/),
 *                                 reference code/docs/images excluded
 *
 * These are what the version-checkpoint tests validate against — "after all
 * migrations ≤ X, the world (rows AND config files) must satisfy what release
 * X actually shipped" — which is exactly what catches a migration homed in
 * the wrong version folder.
 *
 * Extraction paths per tag:
 *   fast  — the tag committed its own snapshot
 *           (`convex/migrations/{schema,config}.snapshot.json`): `git show`.
 *   slow  — older tags: a BARE git worktree of the tag (no install) with the
 *           main repo's node_modules symlinked in, then evaluate that tag's
 *           `convex/schema.ts` / `lib/shared/schemas/*.ts` in a subprocess.
 *           Old modules only need the stable defineSchema/zod construction
 *           surface, so today's deps evaluate them (verified to v0.2.1; a tag
 *           without `lib/shared/schemas/` predates file-config → empty map).
 *
 * Fixtures are HISTORICAL FACTS: once generated for a released tag they never
 * change. The generator is idempotent (existing fixtures are skipped unless
 * `--force`), reports per-tag failures without aborting, and always refreshes
 * the HEAD (in-development) checkpoint set.
 *
 *   bun scripts/dump-version-schemas.ts             # fill missing + refresh dev
 *   bun scripts/dump-version-schemas.ts --force     # regenerate everything
 *   bun scripts/dump-version-schemas.ts --tag v0.2.85
 */

import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync, gzipSync } from 'node:zlib';

import { BASELINE_VERSION } from '../convex/migrations/framework/baseline';
import {
  computeFingerprint,
  serializeFingerprint,
} from '../convex/migrations/framework/schema_fingerprint';
import { compareSemver } from '../convex/migrations/framework/semver';
import {
  computeConfigFingerprint,
  serializeConfigFingerprint,
  type JsonSchema,
} from '../lib/shared/config/config_fingerprint';
import { parseYamlOrThrow, stringifyYaml } from '../lib/shared/config/yaml';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_ROOT = path.join(here, '..');
const REPO_ROOT = path.join(PLATFORM_ROOT, '../..');
const FIXTURES_DIR = path.join(
  PLATFORM_ROOT,
  'convex/migrations/testing/versions',
);
const VERSIONS_DIR = path.join(PLATFORM_ROOT, 'convex/migrations/versions');
const BLOBS_DIR = path.join(FIXTURES_DIR, 'blobs');
// Committed-baseline paths per era: tags cut from 0.4.0 on commit the YAML
// form; released 0.2.x/0.3.x tags carry the retired JSON form. Tag readers
// try YAML first, then fall back.
const SCHEMA_SNAPSHOT_YML_REL =
  'services/platform/convex/migrations/schema.snapshot.yml';
const SCHEMA_SNAPSHOT_JSON_REL =
  'services/platform/convex/migrations/schema.snapshot.json';
const CONFIG_SNAPSHOT_YML_REL =
  'services/platform/convex/migrations/config.snapshot.yml';
const CONFIG_SNAPSHOT_JSON_REL =
  'services/platform/convex/migrations/config.snapshot.json';

/** `git show` the tag's committed snapshot in either era form, parsed. */
function committedSnapshot(
  tag: string,
  ymlRel: string,
  jsonRel: string,
): unknown {
  try {
    return parseYamlOrThrow(git(['show', `${tag}:${ymlRel}`]), {
      maxBytes: 8 * 1024 * 1024,
    });
  } catch {
    // Fall through to the JSON-era path; a tag missing both surfaces below.
  }
  return JSON.parse(git(['show', `${tag}:${jsonRel}`]));
}
const TAG_RE = /^v0\.(2|3)\.\d+$/;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

function tagList(): string[] {
  // Pre-baseline releases are not part of this world's ground truth: the 0.4
  // baseline reset pruned their fixtures, and re-dumping them would resurrect
  // checkpoints no test consumes (the chain restarts empty at the baseline).
  return git(['tag', '--sort=v:refname'])
    .split('\n')
    .filter((t) => TAG_RE.test(t))
    .filter((t) => compareSemver(t.slice(1), BASELINE_VERSION) >= 0);
}

const INDEX_PATH = path.join(FIXTURES_DIR, 'index.yml');

type CheckpointKind = 'dbSchema' | 'configSchema' | 'scaffold';
type CheckpointIndex = Record<string, Partial<Record<CheckpointKind, string>>>;

function loadIndex(): CheckpointIndex {
  return existsSync(INDEX_PATH)
    ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the index is this script's own write
      (parseYamlOrThrow(readFileSync(INDEX_PATH, 'utf-8')) as CheckpointIndex)
    : {};
}

function saveIndex(index: CheckpointIndex): void {
  const sorted = Object.fromEntries(
    Object.entries(index).sort(([a], [b]) =>
      a
        .split('.')
        .map((p) => p.padStart(6, '0'))
        .join('.')
        .localeCompare(
          b
            .split('.')
            .map((p) => p.padStart(6, '0'))
            .join('.'),
        ),
    ),
  );
  writeFileSync(INDEX_PATH, stringifyYaml(sorted));
}

/** Delete blob files no index entry references (re-derived fixtures leave
 *  their previous content-addressed blobs behind). Scaffold entries are
 *  MANIFESTS whose `files` map references second-level content blobs — those
 *  are live too. Returns the count. */
function collectGarbageBlobs(index: CheckpointIndex): number {
  if (!existsSync(BLOBS_DIR)) return 0;
  const referenced = new Set<string>();
  const readBlobLocal = (key: string): string =>
    gunzipSync(readFileSync(path.join(BLOBS_DIR, `${key}.json.gz`))).toString(
      'utf-8',
    );
  for (const entry of Object.values(index)) {
    for (const [kind, key] of Object.entries(entry)) {
      if (typeof key !== 'string') continue;
      referenced.add(`${key}.json.gz`);
      if (kind !== 'scaffold') continue;
      try {
        const manifest = JSON.parse(readBlobLocal(key)) as {
          files?: Record<string, string>;
        };
        for (const fileKey of Object.values(manifest.files ?? {})) {
          referenced.add(`${fileKey}.json.gz`);
        }
      } catch (err) {
        console.warn(
          `[dump-version-schemas] unreadable scaffold manifest ${key}; skipping GC entirely:`,
          err instanceof Error ? err.message : err,
        );
        return 0;
      }
    }
  }
  let removed = 0;
  for (const file of readdirSync(BLOBS_DIR)) {
    if (!file.endsWith('.json.gz') || referenced.has(file)) continue;
    rmSync(path.join(BLOBS_DIR, file));
    removed++;
  }
  return removed;
}

/** Store content once, gzipped, keyed by its sha; returns the blob key. */
function putBlob(content: string): string {
  const sha = createHash('sha256').update(content).digest('hex').slice(0, 24);
  const blobPath = path.join(BLOBS_DIR, `${sha}.json.gz`);
  if (!existsSync(blobPath)) {
    mkdirSync(BLOBS_DIR, { recursive: true });
    writeFileSync(blobPath, gzipSync(Buffer.from(content)));
  }
  return sha;
}

/**
 * The in-development version = the highest migration version folder, or the
 * baseline when the history is empty (right after a baseline reset, before
 * the first post-baseline migration lands).
 */
function devVersion(): string {
  const versions = readdirSync(VERSIONS_DIR)
    .map((d) => /^v(\d+)_(\d+)_(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => `${m[1]}.${m[2]}.${m[3]}`)
    .sort(compareSemver);
  const last = versions.at(-1);
  if (last === undefined || compareSemver(last, BASELINE_VERSION) < 0) {
    return BASELINE_VERSION;
  }
  return last;
}

// ---------------------------------------------------------------------------
// DB schema fingerprints
// ---------------------------------------------------------------------------

/** Fast path: the fingerprint the tag itself committed. */
function schemaFromCommittedSnapshot(tag: string): string | null {
  try {
    const snapshot = committedSnapshot(
      tag,
      SCHEMA_SNAPSHOT_YML_REL,
      SCHEMA_SNAPSHOT_JSON_REL,
    );
    // Round-trip through the fingerprint types so every fixture is in the
    // same canonical serialization regardless of era.
    return serializeFingerprint(
      computeFingerprint(
        JSON.stringify(fingerprintToExportShape(JSON.stringify(snapshot))),
      ),
    );
  } catch {
    return null;
  }
}

/**
 * The committed snapshot already IS a fingerprint ({schemaValidation,
 * tables:{name:{field:{ft,optional}}}}); convert it to the `schema.export()`
 * shape `computeFingerprint` consumes so both paths share one normalizer.
 */
function fingerprintToExportShape(raw: string): {
  schemaValidation?: boolean;
  tables: Array<{
    tableName: string;
    documentType: { value: Record<string, unknown> };
  }>;
} {
  const parsed = JSON.parse(raw) as {
    schemaValidation?: boolean;
    tables?: Record<
      string,
      Record<string, { ft: unknown; optional?: boolean }>
    >;
  };
  return {
    schemaValidation: parsed.schemaValidation,
    tables: Object.entries(parsed.tables ?? {}).map(([tableName, fields]) => ({
      tableName,
      documentType: {
        value: Object.fromEntries(
          Object.entries(fields).map(([name, f]) => [
            name,
            { fieldType: f.ft, optional: f.optional === true },
          ]),
        ),
      },
    })),
  };
}

function schemaFromWorktree(worktree: string): string {
  const schemaPath = path.join(worktree, 'services/platform/convex/schema.ts');
  if (!existsSync(schemaPath)) {
    throw new Error('no services/platform/convex/schema.ts at this tag');
  }
  // Evaluate in a subprocess so one incompatible tag can't poison this
  // process's module cache (and a crash is contained + reported).
  const dumper = `
    const mod = await import(${JSON.stringify(schemaPath)});
    const schema = mod.default;
    const exportFn = Reflect.get(schema, 'export');
    if (typeof exportFn !== 'function') throw new Error('schema has no export()');
    process.stdout.write(String(exportFn.call(schema)));
  `;
  const exported = execFileSync('bun', ['-e', dumper], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return serializeFingerprint(computeFingerprint(exported));
}

// ---------------------------------------------------------------------------
// Org-config (Zod) fingerprints
// ---------------------------------------------------------------------------

/** Fast path: normalize the tag's committed config snapshot. */
function configFromCommittedSnapshot(tag: string): string | null {
  try {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- both era forms are this repo's own writes
    const parsed = committedSnapshot(
      tag,
      CONFIG_SNAPSHOT_YML_REL,
      CONFIG_SNAPSHOT_JSON_REL,
    ) as {
      schemas?: Record<string, JsonSchema>;
    };
    return serializeConfigFingerprint(
      computeConfigFingerprint(parsed.schemas ?? {}),
    );
  } catch {
    return null;
  }
}

/**
 * Enumerate `<root>/lib/shared/schemas/*.ts`, import each module, render
 * every exported Zod schema to JSON Schema — the exact discovery
 * `check-config-snapshot.ts` performs, run inside a subprocess so a
 * tag-incompatible module is contained. A tag without the schemas dir
 * predates file-based config → empty map (a correct historical fact).
 */
function configFromTree(platformRoot: string): string {
  const schemasDir = path.join(platformRoot, 'lib/shared/schemas');
  if (!existsSync(schemasDir)) {
    return serializeConfigFingerprint(computeConfigFingerprint({}));
  }
  const dumper = `
    import { readdirSync } from 'node:fs';
    import path from 'node:path';
    import { pathToFileURL } from 'node:url';
    import { z } from 'zod/v4';
    const dir = ${JSON.stringify(schemasDir)};
    const out = {};
    const skipped = [];
    for (const f of readdirSync(dir).filter((f) => f.endsWith('.ts') && !f.endsWith('.test.ts')).sort()) {
      let mod;
      try {
        mod = await import(pathToFileURL(path.join(dir, f)).href);
      } catch (err) {
        skipped.push(f + ': ' + String(err).slice(0, 120));
        continue;
      }
      for (const name of Object.keys(mod).sort()) {
        const value = mod[name];
        if (!value || typeof value !== 'object' || !('_zod' in value)) continue;
        try {
          out[f.replace(/\\.ts$/, '') + '.' + name] = z.toJSONSchema(value, { unrepresentable: 'any' });
        } catch (err) {
          skipped.push(f + '.' + name + ': ' + String(err).slice(0, 120));
        }
      }
    }
    process.stdout.write(JSON.stringify({ out, skipped }));
  `;
  const result = execFileSync('bun', ['-e', dumper], {
    cwd: REPO_ROOT,
    encoding: 'utf-8',
    maxBuffer: 64 * 1024 * 1024,
  });
  const { out, skipped } = JSON.parse(result) as {
    out: Record<string, JsonSchema>;
    skipped: string[];
  };
  if (skipped.length > 0) {
    console.warn(`    (config: ${skipped.length} module(s)/schema(s) skipped)`);
  }
  return serializeConfigFingerprint(computeConfigFingerprint(out));
}

// ---------------------------------------------------------------------------
// Builtin scaffold trees — what an INITIALIZED project of that era contains
// ---------------------------------------------------------------------------

/**
 * Reference-code and non-data content excluded from scaffold manifests: a
 * fresh org's DATA files are the config documents; skill bundles, docs,
 * scripts, and images are reference material, not migratable data shapes.
 */
const SCAFFOLD_EXCLUDES: readonly RegExp[] = [
  /^builtin-configs\/skills\//,
  /^configs\/platform\/custom\/skills\//,
  /\.(md|mdx)$/i,
  /\.(png|jpe?g|webp|gif|ico|svg)$/i,
  /\.(py|sh|ts|js)$/i,
];

interface ScaffoldManifest {
  /** repo-relative builtin path → sha256 of the file content. */
  readonly files: Record<string, string>;
}

/**
 * The tag's `builtin-configs/` catalog (the source a fresh org is scaffolded
 * from), as a content-addressed manifest: file paths + content hashes, with
 * each unique content stored ONCE under `versions/blobs/<sha>.blob` so 100+
 * versions of a slowly-changing catalog stay compact. Pre-file-config tags
 * have no catalog → empty manifest (a correct historical fact).
 */
function scaffoldFromTag(tag: string): ScaffoldManifest {
  let listing = '';
  try {
    listing = git([
      'ls-tree',
      '-r',
      '--name-only',
      tag,
      '--',
      'builtin-configs',
    ]);
  } catch {
    return { files: {} };
  }
  const files: Record<string, string> = {};
  for (const rel of listing.split('\n').filter(Boolean).sort()) {
    if (SCAFFOLD_EXCLUDES.some((re) => re.test(rel))) continue;
    const content = git(['show', `${tag}:${rel}`]);
    files[rel] = putBlob(content);
  }
  return { files };
}

/**
 * HEAD variant: read the live per-org seed catalog from the filesystem.
 * Since the config-system rewrite the catalog lives at
 * `configs/platform/custom/` (the `builtin-configs/` tree is retired) — a
 * plain directory walk, not `git ls-files`, so the manifest reflects the
 * working tree even while the rewrite's files are intentionally unstaged.
 * Dotfiles (`.gitkeep` placeholders) are skipped: they are directory
 * markers, not scaffolded data.
 */
function scaffoldFromHead(): ScaffoldManifest {
  const catalogRoot = path.join(REPO_ROOT, 'configs/platform/custom');
  const files: Record<string, string> = {};
  if (!existsSync(catalogRoot)) return { files };
  const entries = readdirSync(catalogRoot, {
    recursive: true,
    withFileTypes: true,
  });
  const rels = entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      path
        .relative(REPO_ROOT, path.join(entry.parentPath, entry.name))
        .split(path.sep)
        .join('/'),
    )
    .sort();
  for (const rel of rels) {
    if (rel.split('/').some((segment) => segment.startsWith('.'))) continue;
    if (SCAFFOLD_EXCLUDES.some((re) => re.test(rel))) continue;
    files[rel] = putBlob(readFileSync(path.join(REPO_ROOT, rel), 'utf-8'));
  }
  return { files };
}

function serializeScaffold(manifest: ScaffoldManifest): string {
  const sorted = Object.fromEntries(
    Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b)),
  );
  return `${JSON.stringify({ files: sorted }, null, 2)}\n`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------

function withWorktree<T>(tag: string, fn: (worktree: string) => T): T {
  const worktree = path.join(tmpdir(), `tale-version-dump-${process.pid}`);
  rmSync(worktree, { recursive: true, force: true });
  git(['worktree', 'add', '--force', '--detach', worktree, tag]);
  try {
    symlinkSync(
      path.join(REPO_ROOT, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'dir',
    );
    return fn(worktree);
  } finally {
    try {
      git(['worktree', 'remove', '--force', worktree]);
    } catch (cleanupErr) {
      console.warn(
        `[dump-version-schemas] worktree cleanup failed for ${tag}:`,
        cleanupErr instanceof Error ? cleanupErr.message : cleanupErr,
      );
      rmSync(worktree, { recursive: true, force: true });
    }
  }
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  // Re-derive configSchema from every tag's REAL Zod schemas (worktree eval)
  // instead of the committed config.snapshot.json: historical snapshots were
  // captured with the annotation-stripper bug that dropped properties named
  // description/title/default/id, so the fast path is permanently lossy.
  const slowConfig = process.argv.includes('--slow-config');
  const onlyTagIdx = process.argv.indexOf('--tag');
  const onlyTag = onlyTagIdx >= 0 ? process.argv[onlyTagIdx + 1] : null;

  mkdirSync(FIXTURES_DIR, { recursive: true });
  const index = force && !onlyTag ? {} : loadIndex();
  const tags = onlyTag ? [onlyTag] : tagList();
  const failures: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const tag of tags) {
    const version = tag.slice(1);
    const entry = index[version] ?? {};
    const needSchema = force || !entry.dbSchema;
    const needConfig = force || slowConfig || !entry.configSchema;
    const needScaffold = force || !entry.scaffold;
    if (!needSchema && !needConfig && !needScaffold) {
      skipped++;
      continue;
    }
    try {
      let schemaFp = needSchema ? schemaFromCommittedSnapshot(tag) : null;
      let configFp =
        needConfig && !slowConfig ? configFromCommittedSnapshot(tag) : null;
      if ((needSchema && !schemaFp) || (needConfig && !configFp)) {
        withWorktree(tag, (worktree) => {
          if (needSchema && !schemaFp) schemaFp = schemaFromWorktree(worktree);
          if (needConfig && !configFp) {
            configFp = configFromTree(path.join(worktree, 'services/platform'));
          }
        });
      }
      if (needSchema && schemaFp) {
        entry.dbSchema = putBlob(schemaFp);
        written++;
      }
      if (needConfig && configFp) {
        entry.configSchema = putBlob(configFp);
        written++;
      }
      if (needScaffold) {
        entry.scaffold = putBlob(serializeScaffold(scaffoldFromTag(tag)));
        written++;
      }
      index[version] = entry;
      console.log(`  ✓ ${tag}`);
    } catch (err) {
      failures.push(
        `${tag}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
      console.warn(`  ✗ ${tag} — see summary`);
    }
  }

  // The in-development checkpoint set is always refreshed: it tracks HEAD.
  if (!onlyTag) {
    const dev = devVersion();
    const mod = (await import('../convex/schema')) as { default: unknown };
    const exportFn = Reflect.get(mod.default as object, 'export');
    if (typeof exportFn !== 'function') {
      throw new Error('current schema has no export()');
    }
    index[dev] = {
      dbSchema: putBlob(
        serializeFingerprint(
          computeFingerprint(String(exportFn.call(mod.default))),
        ),
      ),
      configSchema: putBlob(configFromTree(PLATFORM_ROOT)),
      scaffold: putBlob(serializeScaffold(scaffoldFromHead())),
    };
    console.log(`  ✓ ${dev} (in-development HEAD)`);
    written += 3;
  }

  saveIndex(index);
  const orphans = collectGarbageBlobs(index);
  console.log(
    `[dump-version-schemas] ${written} fixture(s) written, ${skipped} tag(s) already complete${
      orphans > 0 ? `, ${orphans} orphaned blob(s) removed` : ''
    }${failures.length > 0 ? `, ${failures.length} FAILED` : ''}.`,
  );
  if (failures.length > 0) {
    console.error('  failures:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

await main();
