/**
 * Per-version schema checkpoint generator: one fingerprint fixture per
 * released version (every `v0.2.x` / `v0.3.x` git tag) plus the in-development
 * HEAD, under `convex/migrations/testing/versions/`. These are the ground
 * truth the version-checkpoint tests validate against — "after all migrations
 * ≤ X, the world must satisfy the schema release X actually shipped" — which
 * is exactly what catches a migration homed in the wrong version folder.
 *
 * Two extraction paths per tag:
 *   fast  — the tag committed `convex/migrations/schema.snapshot.json`
 *           (already the serialized fingerprint format): `git show` it.
 *   slow  — older tags: a BARE git worktree of the tag (no install) with the
 *           main repo's node_modules symlinked in, then evaluate that tag's
 *           `convex/schema.ts` and fingerprint `schema.export()`. Old schema
 *           modules only need the stable defineSchema/defineTable surface, so
 *           today's convex package evaluates them fine (verified back to
 *           v0.2.1).
 *
 * Fixtures are HISTORICAL FACTS: once generated for a released tag they never
 * change. The generator is idempotent (existing fixtures are skipped unless
 * `--force`), reports per-tag failures without aborting the run, and always
 * refreshes the HEAD (`-dev`) checkpoint.
 *
 *   bun scripts/dump-version-schemas.ts             # fill missing + refresh dev
 *   bun scripts/dump-version-schemas.ts --force     # regenerate everything
 *   bun scripts/dump-version-schemas.ts --tag v0.2.85
 */

import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  computeFingerprint,
  serializeFingerprint,
} from '../convex/migrations/framework/schema_fingerprint';

const here = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_ROOT = path.join(here, '..');
const REPO_ROOT = path.join(PLATFORM_ROOT, '../..');
const FIXTURES_DIR = path.join(
  PLATFORM_ROOT,
  'convex/migrations/testing/versions',
);
const VERSIONS_DIR = path.join(PLATFORM_ROOT, 'convex/migrations/versions');
const SNAPSHOT_REL = 'services/platform/convex/migrations/schema.snapshot.json';
const TAG_RE = /^v0\.(2|3)\.\d+$/;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

function tagList(): string[] {
  return git(['tag', '--sort=v:refname'])
    .split('\n')
    .filter((t) => TAG_RE.test(t));
}

function fixturePath(version: string): string {
  return path.join(
    FIXTURES_DIR,
    `v${version.replaceAll('.', '_')}.schema.json`,
  );
}

/** The in-development version = the highest migration version folder. */
function devVersion(): string {
  const versions = readdirSync(VERSIONS_DIR)
    .map((d) => /^v(\d+)_(\d+)_(\d+)$/.exec(d))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => ({
      key: `${m[1].padStart(6, '0')}.${m[2].padStart(6, '0')}.${m[3].padStart(6, '0')}`,
      semver: `${m[1]}.${m[2]}.${m[3]}`,
    }))
    .sort((a, b) => a.key.localeCompare(b.key));
  const last = versions.at(-1);
  if (!last) throw new Error('no migration version folders found');
  return last.semver;
}

/** Fast path: the fingerprint the tag itself committed. */
function fromCommittedSnapshot(tag: string): string | null {
  try {
    const raw = git(['show', `${tag}:${SNAPSHOT_REL}`]);
    // Round-trip through the fingerprint types so every fixture is in the
    // same canonical serialization regardless of era.
    return serializeFingerprint(
      computeFingerprint(fingerprintToExportShape(raw)),
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

/** Slow path: bare worktree + evaluate the tag's schema.ts with today's deps. */
function fromWorktreeEval(tag: string): string {
  const worktree = path.join(tmpdir(), `tale-version-dump-${process.pid}`);
  rmSync(worktree, { recursive: true, force: true });
  git(['worktree', 'add', '--force', '--detach', worktree, tag]);
  try {
    symlinkSync(
      path.join(REPO_ROOT, 'node_modules'),
      path.join(worktree, 'node_modules'),
      'dir',
    );
    const schemaPath = path.join(
      worktree,
      'services/platform/convex/schema.ts',
    );
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

/** HEAD checkpoint: fingerprint the CURRENT schema module directly. */
async function fromHead(): Promise<string> {
  const mod = (await import('../convex/schema')) as { default: unknown };
  const exportFn = Reflect.get(mod.default as object, 'export');
  if (typeof exportFn !== 'function') {
    throw new Error('current schema has no export()');
  }
  return serializeFingerprint(
    computeFingerprint(String(exportFn.call(mod.default))),
  );
}

async function main(): Promise<void> {
  const force = process.argv.includes('--force');
  const onlyTagIdx = process.argv.indexOf('--tag');
  const onlyTag = onlyTagIdx >= 0 ? process.argv[onlyTagIdx + 1] : null;

  mkdirSync(FIXTURES_DIR, { recursive: true });
  const tags = onlyTag ? [onlyTag] : tagList();
  const failures: string[] = [];
  let written = 0;
  let skipped = 0;

  for (const tag of tags) {
    const version = tag.slice(1);
    const target = fixturePath(version);
    if (!force && existsSync(target)) {
      skipped++;
      continue;
    }
    try {
      const fingerprint = fromCommittedSnapshot(tag) ?? fromWorktreeEval(tag);
      writeFileSync(target, fingerprint);
      written++;
      console.log(`  ✓ ${tag}`);
    } catch (err) {
      failures.push(
        `${tag}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`,
      );
      console.warn(`  ✗ ${tag} — see summary`);
    }
  }

  // The in-development checkpoint is always refreshed: it tracks HEAD.
  if (!onlyTag) {
    const dev = devVersion();
    writeFileSync(fixturePath(dev), await fromHead());
    console.log(`  ✓ ${dev} (in-development HEAD)`);
    written++;
  }

  console.log(
    `[dump-version-schemas] ${written} written, ${skipped} already present${
      failures.length > 0 ? `, ${failures.length} FAILED` : ''
    }.`,
  );
  if (failures.length > 0) {
    console.error('  failures:\n  - ' + failures.join('\n  - '));
    process.exit(1);
  }
}

await main();
