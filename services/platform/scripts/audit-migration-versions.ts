/**
 * Version-placement audit: does every migration live in the version folder
 * whose RELEASE actually shipped its schema change?
 *
 * Method: the per-version checkpoint fixtures (scripts/dump-version-schemas.ts)
 * give the real schema at every released tag. Diffing consecutive fingerprints
 * yields the authoritative per-release change inventory; each migration's
 * declared tables are then matched against the inventory to find the
 * release(s) that actually touched them.
 *
 * Verdicts per migration:
 *   OK        — its version's release diff touches its tables
 *   MISMATCH  — its tables changed in a DIFFERENT release (candidates listed)
 *   NO-SIGNAL — its tables never appear in any DB schema diff (node/config
 *               migrations whose change lives in org-config files, or purely
 *               behavioral backfills; needs config-side or manual evidence)
 *
 * Read-only reporting tool — run with `bun scripts/audit-migration-versions.ts`.
 * `--json` emits the machine-readable inventory.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  diffFingerprints,
  type SchemaFingerprint,
} from '../convex/migrations/framework/schema_fingerprint';
import { discoverMigrations, validateSet } from './migrations-codegen';

const here = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES_DIR = path.join(here, '../convex/migrations/testing/versions');

interface ReleaseChange {
  readonly version: string;
  readonly table: string;
  readonly field: string;
  readonly kind: string;
  readonly detail: string;
}

function loadCheckpoints(): Array<{ version: string; fp: SchemaFingerprint }> {
  if (!existsSync(FIXTURES_DIR)) {
    throw new Error(
      'no version fixtures — run `bun scripts/dump-version-schemas.ts` first',
    );
  }
  return readdirSync(FIXTURES_DIR)
    .filter((f) => f.endsWith('.schema.json'))
    .map((f) => {
      const version = f
        .replace(/^v/, '')
        .replace('.schema.json', '')
        .replaceAll('_', '.');
      const fp = JSON.parse(
        readFileSync(path.join(FIXTURES_DIR, f), 'utf-8'),
      ) as SchemaFingerprint;
      return { version, fp, key: orderKeyOf(version) };
    })
    .sort((a, b) => a.key.localeCompare(b.key))
    .map(({ version, fp }) => ({ version, fp }));
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
        field: change.field,
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

    let verdict: 'OK' | 'MISMATCH' | 'NO-SIGNAL';
    if (releases.includes(m.semver)) {
      verdict = 'OK';
    } else if (releases.length > 0) {
      verdict = 'MISMATCH';
    } else {
      verdict = 'NO-SIGNAL';
    }
    report.push({
      id: m.id,
      kind: m.kind,
      verdict,
      declared: m.semver,
      evidence: touching
        .filter((c) => c.version === m.semver)
        .map((c) => `${c.table}.${c.field} ${c.kind}`),
      candidates: releases.filter((r) => r !== m.semver),
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
