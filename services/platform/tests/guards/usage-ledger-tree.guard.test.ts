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
 *
 * The budget gate reads the ledger's rollups (`0235_usage_period_rollups.sql`),
 * which statement triggers on each table of the tree keep: a statement fires
 * the triggers of the table it names alone, so a table without them books
 * spend no budget sees, and `TRUNCATE` fires no delete trigger, so a
 * truncated ledger leaves its rollups standing.
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

const TRUNCATES_THE_LEDGER = /\bTRUNCATE\b[^;`]*\bapp\.usage_ledger/i;

/** The function the rollups' triggers run. */
const JOURNAL = 'app.journal_usage_ledger_changes()';
const JOURNALED_EVENTS = ['DELETE', 'INSERT', 'UPDATE'];

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

/** The ledger's parent and every table a migration makes inherit it. */
function ledgerTree(migrations: readonly string[]): string[] {
  const children =
    /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(app\.\w+)\s*\([^;]*?\)\s*INHERITS\s*\(\s*app\.usage_ledger\s*\)/gi;
  return [
    'app.usage_ledger',
    ...migrations.flatMap((sql) =>
      [...sql.matchAll(children)].map((match) => match[1] ?? ''),
    ),
  ];
}

/**
 * The events each table's journal triggers stand on after the migrations
 * run in order: a statement trigger with its transition table, created on
 * the table and not dropped by a later statement.
 */
function journaledEvents(
  migrations: readonly string[],
): Map<string, Set<string>> {
  const statement =
    /(DROP\s+TRIGGER\s+(?:IF\s+EXISTS\s+)?(\w+)\s+ON\s+(app\.\w+))|(CREATE\s+(?:OR\s+REPLACE\s+)?TRIGGER\s+(\w+)\s+AFTER\s+(INSERT|UPDATE|DELETE)\s+ON\s+(app\.\w+)\s+REFERENCING\s+[^;]*?FOR\s+EACH\s+STATEMENT\s+EXECUTE\s+(?:FUNCTION|PROCEDURE)\s+([\w.]+\(\)))/gi;
  const triggers = new Map<string, { table: string; event: string }>();
  for (const sql of migrations) {
    for (const match of sql.matchAll(statement)) {
      if (match[1]) {
        triggers.delete(`${match[3]}:${match[2]}`);
      } else if (match[8] === JOURNAL) {
        triggers.set(`${match[7]}:${match[5]}`, {
          table: match[7] ?? '',
          event: (match[6] ?? '').toUpperCase(),
        });
      }
    }
  }
  const events = new Map<string, Set<string>>();
  for (const { table, event } of triggers.values()) {
    events.set(table, (events.get(table) ?? new Set()).add(event));
  }
  return events;
}

function migrationsInOrder(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((name) => name.endsWith('.sql'))
    .sort()
    .map((name) => readFileSync(path.join(MIGRATIONS, name), 'utf8'));
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

describe('every table of the ledger tree journals its changes for the budget rollups', () => {
  it('each table carries the journal trigger for every event that changes it', () => {
    const migrations = migrationsInOrder();
    const events = journaledEvents(migrations);
    const tree = ledgerTree(migrations);
    expect(tree).toContain('app.usage_ledger_provider');
    for (const table of tree) {
      expect({ table, events: [...(events.get(table) ?? [])].sort() }).toEqual({
        table,
        events: JOURNALED_EVENTS,
      });
    }
  });

  it('no source truncates the ledger', () => {
    const offenders: string[] = [];
    for (const root of SOURCE_ROOTS) {
      for (const file of sourceFiles(path.join(PLATFORM_ROOT, root))) {
        if (TRUNCATES_THE_LEDGER.test(readFileSync(file, 'utf8'))) {
          offenders.push(path.relative(PLATFORM_ROOT, file));
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it('reads the tree and its triggers, a later drop included', () => {
    const migrations = [
      'CREATE TABLE IF NOT EXISTS app.usage_ledger_x (\n  a text\n) INHERITS (app.usage_ledger);',
      [
        'CREATE TRIGGER t_insert AFTER INSERT ON app.usage_ledger_x',
        '  REFERENCING NEW TABLE AS new_rows',
        `  FOR EACH STATEMENT EXECUTE FUNCTION ${JOURNAL};`,
        'CREATE TRIGGER t_delete AFTER DELETE ON app.usage_ledger_x',
        '  REFERENCING OLD TABLE AS old_rows',
        `  FOR EACH STATEMENT EXECUTE FUNCTION ${JOURNAL};`,
        'CREATE TRIGGER t_row AFTER UPDATE ON app.usage_ledger_x',
        `  FOR EACH ROW EXECUTE FUNCTION ${JOURNAL};`,
      ].join('\n'),
      'DROP TRIGGER IF EXISTS t_delete ON app.usage_ledger_x;',
    ];
    expect(ledgerTree(migrations)).toEqual([
      'app.usage_ledger',
      'app.usage_ledger_x',
    ]);
    expect([
      ...(journaledEvents(migrations).get('app.usage_ledger_x') ?? []),
    ]).toEqual(['INSERT']);
    expect(
      TRUNCATES_THE_LEDGER.test('TRUNCATE app.usage_ledger_provider'),
    ).toBe(true);
    expect(TRUNCATES_THE_LEDGER.test('TRUNCATE app.usage_period_deltas')).toBe(
      false,
    );
  });
});
