// @vitest-environment node

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * The usage ledger is an inheritance tree. `app.usage_ledger` is the table
 * the previous image still books; `app.usage_ledger_provider` inherits it and
 * takes what the current image books, with the provider in its bucket key
 * (`0204_usage_ledger_provider.sql`). A plain read, update or delete of the
 * parent covers both tables, so the usage page, the budget gate, erasure and
 * retention fold one ledger. Two mistakes would split it again, and the
 * governance README (`backend/domains/governance/README.md`) forbids both:
 *
 * - `ONLY app.usage_ledger` names the parent alone, so a reader sees half the
 *   spend and a deleter leaves the other half behind;
 * - an index is not inherited, so a later migration that indexes the parent
 *   and not the child leaves every row the current image books to a scan.
 */

const PLATFORM_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const SOURCE_ROOTS = ['backend', 'lib'];
const MIGRATIONS = path.join(PLATFORM_ROOT, 'backend/db/migrations');

/** The migration that gave the ledger its child table. */
const CHILD_TABLE_MIGRATION = '0204';

const ONLY_THE_PARENT = /\bONLY\s+app\.usage_ledger\b(?!_)/i;

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      out.push(full);
    }
  }
  return out;
}

/** The index statements of a migration that name this table as their target. */
function indexesOn(sql: string, table: string): string[] {
  const statement = new RegExp(
    `CREATE\\s+(?:UNIQUE\\s+)?INDEX\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?\\S+\\s+ON\\s+${table.replace('.', '\\.')}\\s*\\(`,
    'gi',
  );
  return [...sql.matchAll(statement)].map((match) => match[0]);
}

describe('the usage ledger is read and indexed as one tree', () => {
  it('no source names the parent table alone', () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(path.join(PLATFORM_ROOT, root))) {
        if (ONLY_THE_PARENT.test(readFileSync(file, 'utf8'))) {
          offenders.push(path.relative(PLATFORM_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('every ledger index a later migration adds lands on both tables', () => {
    const later = readdirSync(MIGRATIONS)
      .filter((name) => name.endsWith('.sql'))
      .filter((name) => name.slice(0, 4) > CHILD_TABLE_MIGRATION)
      .sort();
    const missing: string[] = [];
    for (const name of later) {
      const sql = readFileSync(path.join(MIGRATIONS, name), 'utf8');
      if (
        indexesOn(sql, 'app.usage_ledger').length > 0 &&
        indexesOn(sql, 'app.usage_ledger_provider').length === 0
      ) {
        missing.push(name);
      }
    }
    expect(missing).toEqual([]);
  });

  it('reads an index statement on either table', () => {
    const sql = [
      'CREATE INDEX IF NOT EXISTS a ON app.usage_ledger (org_id);',
      'CREATE UNIQUE INDEX b ON app.usage_ledger_provider (org_id);',
    ].join('\n');
    expect(indexesOn(sql, 'app.usage_ledger')).toHaveLength(1);
    expect(indexesOn(sql, 'app.usage_ledger_provider')).toHaveLength(1);
    expect(ONLY_THE_PARENT.test('SELECT 1 FROM ONLY app.usage_ledger')).toBe(
      true,
    );
    expect(
      ONLY_THE_PARENT.test('SELECT 1 FROM ONLY app.usage_ledger_provider'),
    ).toBe(false);
  });
});
