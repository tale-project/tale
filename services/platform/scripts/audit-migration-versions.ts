/**
 * Version-placement audit: does every migration live in the version folder
 * whose RELEASE actually shipped its change?
 *
 * Two independent evidence sources:
 *  1. Schema diffs — the per-version checkpoint fixtures
 *     (scripts/dump-version-schemas.ts) give the real schema at every
 *     released tag; diffing consecutive fingerprints yields the per-release
 *     change inventory, matched against each migration's declared tables.
 *  2. Ship tags — the first released tag whose tree contains the migration
 *     folder (via git; a re-homed folder is looked up under its former ids'
 *     paths). A migration that first shipped in vX ran on vX deployments —
 *     that IS its home. Config/behavioral migrations with no schema footprint
 *     are judged by this signal alone.
 *
 * Verdicts per migration:
 *   OK        — declared version matches a release whose diff touches its
 *               tables, OR the release that first shipped it, OR (never
 *               released) the in-development version
 *   MISMATCH  — both signals point elsewhere (candidates listed)
 *   NO-SIGNAL — no schema diff AND no ship-tag evidence
 *
 * Read-only reporting tool — run with `bun scripts/audit-migration-versions.ts`.
 * `--json` emits the machine-readable inventory.
 */

import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diffFingerprints,
  type SchemaFingerprint,
} from '../convex/migrations/framework/schema_fingerprint';
import {
  checkpointVersions,
  loadDbCheckpoint,
} from '../convex/migrations/testing/checkpoints.testkit';
import { discoverMigrations, validateSet } from './migrations-codegen';

const here = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(here, '../../..');
const RELEASE_TAG_RE = /^v0\.(2|3)\.\d+$/;

function git(args: string[]): string {
  return execFileSync('git', args, { cwd: REPO_ROOT, encoding: 'utf-8' });
}

/** `0.2.88/01_app_config_to_bindings` → its repo-relative folder path. */
function idToFolder(id: string): string {
  const [semver, folder] = id.split('/');
  return `services/platform/convex/migrations/versions/v${semver.replaceAll('.', '_')}/${folder}`;
}

/**
 * The release that FIRST shipped the migration folder, or null when no
 * released tag contains it (dev-cycle work). Former-id paths are checked
 * first — a re-homed folder's history lives where it originally shipped.
 */
function firstShippedRelease(
  rel: string,
  formerIds: readonly string[],
): string | null {
  const folders = [
    ...formerIds.map(idToFolder),
    `services/platform/convex/migrations/versions/${rel}`,
  ];
  for (const folder of folders) {
    const commit = git([
      'log',
      '--diff-filter=A',
      '--format=%H',
      '--reverse',
      '--',
      folder,
    ])
      .split('\n')
      .find((line) => line.length > 0);
    if (!commit) continue;
    const tag = git(['tag', '--contains', commit, '--sort=v:refname'])
      .split('\n')
      .find((t) => RELEASE_TAG_RE.test(t));
    return tag ? tag.slice(1) : null;
  }
  return null;
}

interface ReleaseChange {
  readonly version: string;
  readonly table: string;
  readonly field: string;
  readonly kind: string;
  readonly detail: string;
}

function loadCheckpoints(): Array<{ version: string; fp: SchemaFingerprint }> {
  return checkpointVersions()
    .map((version) => ({ version, key: orderKeyOf(version) }))
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ version }) => ({ version, fp: loadDbCheckpoint(version) }));
}

function orderKeyOf(version: string): string {
  return version
    .split('.')
    .map((p) => p.padStart(6, '0'))
    .join('.');
}

/** Tables ADDED/DROPPED between fingerprints (diffFingerprints only reports
 *  field-level changes on shared tables plus drops; adds are silent-safe). */
function tableSetChanges(
  prev: SchemaFingerprint,
  curr: SchemaFingerprint,
  version: string,
): ReleaseChange[] {
  const out: ReleaseChange[] = [];
  const prevTables = new Set(Object.keys(prev.tables));
  const currTables = new Set(Object.keys(curr.tables));
  for (const t of currTables) {
    if (!prevTables.has(t)) {
      out.push({
        version,
        table: t,
        field: '*',
        kind: 'table-added',
        detail: '',
      });
    }
  }
  for (const t of prevTables) {
    if (!currTables.has(t)) {
      out.push({
        version,
        table: t,
        field: '*',
        kind: 'table-dropped',
        detail: '',
      });
    }
  }
  return out;
}

function releaseInventory(
  checkpoints: Array<{ version: string; fp: SchemaFingerprint }>,
): ReleaseChange[] {
  const out: ReleaseChange[] = [];
  for (let i = 1; i < checkpoints.length; i++) {
    const prev = checkpoints[i - 1];
    const curr = checkpoints[i];
    out.push(...tableSetChanges(prev.fp, curr.fp, curr.version));
    for (const change of diffFingerprints(prev.fp, curr.fp)) {
      out.push({
        version: curr.version,
        table: change.table,
        field: change.field ?? '*',
        kind: change.kind,
        detail: change.detail,
      });
    }
  }
  return out;
}

async function main(): Promise<void> {
  const asJson = process.argv.includes('--json');
  const checkpoints = loadCheckpoints();
  const inventory = releaseInventory(checkpoints);

  const errors: string[] = [];
  const migrations = await discoverMigrations(errors);
  validateSet(migrations, errors);
  if (errors.length > 0) {
    console.error('[audit] discovery errors:\n  - ' + errors.join('\n  - '));
    process.exit(1);
  }

  // table -> releases whose diff touched it
  const releasesByTable = new Map<string, ReleaseChange[]>();
  for (const change of inventory) {
    const list = releasesByTable.get(change.table) ?? [];
    list.push(change);
    releasesByTable.set(change.table, list);
  }

  const report: Array<{
    id: string;
    kind: string;
    verdict: 'OK' | 'MISMATCH' | 'NO-SIGNAL';
    declared: string;
    evidence: string[];
    candidates: string[];
  }> = [];

  const devVersion = checkpoints.at(-1)?.version;

  for (const m of migrations) {
    const tables = [
      ...new Set(
        [m.table, ...(m.subjects?.tables ?? [])].filter(
          (t): t is string =>
            typeof t === 'string' && !t.startsWith('betterAuth:'),
        ),
      ),
    ];
    const touching = tables.flatMap((t) => releasesByTable.get(t) ?? []);
    const releases = [...new Set(touching.map((c) => c.version))];
    // Ship-tag evidence applies to RUNNABLE kinds only: a reference migration
    // documents a change that shipped inside a release's own code — its
    // folder appears in git whenever the documentation was written.
    const shipped =
      m.kind === 'reference'
        ? null
        : firstShippedRelease(m.rel, m.meta.formerIds ?? []);

    const evidence = touching
      .filter((c) => c.version === m.semver)
      .map((c) => `${c.table}.${c.field} ${c.kind}`);

    let verdict: 'OK' | 'MISMATCH' | 'NO-SIGNAL';
    if (releases.includes(m.semver)) {
      verdict = 'OK';
    } else if (shipped === m.semver) {
      verdict = 'OK';
      evidence.push(`first shipped in v${m.semver}`);
    } else if (
      m.semver === devVersion &&
      (m.kind === 'reference'
        ? releases.includes(devVersion)
        : shipped === null)
    ) {
      verdict = 'OK';
      evidence.push('never released — in-development version');
    } else if (releases.length > 0 || shipped !== null) {
      verdict = 'MISMATCH';
    } else {
      verdict = 'NO-SIGNAL';
    }
    report.push({
      id: m.id,
      kind: m.kind,
      verdict,
      declared: m.semver,
      evidence,
      candidates: [
        ...releases.filter((r) => r !== m.semver),
        ...(shipped && shipped !== m.semver ? [`shipped:v${shipped}`] : []),
      ],
    });
  }

  if (asJson) {
    console.log(JSON.stringify({ inventory, report }, null, 2));
    return;
  }

  const counts = { OK: 0, MISMATCH: 0, 'NO-SIGNAL': 0 };
  for (const r of report) counts[r.verdict]++;
  console.log(
    `[audit] ${checkpoints.length} checkpoints, ${inventory.length} release changes, ${report.length} migrations — OK ${counts.OK}, MISMATCH ${counts.MISMATCH}, NO-SIGNAL ${counts['NO-SIGNAL']}\n`,
  );
  for (const r of report) {
    if (r.verdict === 'OK') continue;
    console.log(
      `  ${r.verdict.padEnd(9)} ${r.id} (${r.kind}) — declared ${r.declared}` +
        (r.candidates.length > 0
          ? `; its tables changed in: ${r.candidates.join(', ')}`
          : '; no DB-schema signal (config/behavioral change)'),
    );
  }
  console.log('\n  (OK rows suppressed; --json for the full inventory.)');
}

await main();
