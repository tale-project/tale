// @vitest-environment node

/**
 * Unit lock for `saveVersion`'s write shape (definition-integrity class):
 * every writer of one name takes the per-name advisory lock BEFORE reading
 * `max(version)` (two concurrent saves become versions N and N+1, never a
 * UNIQUE (org_id, name, version) collision surfacing as a 500); a
 * create-only save of a name that already has versions is refused with a
 * coded 409 and writes nothing (the wizard once appended a version to — and
 * then rebound the trigger of — a live automation sharing the slug); and the
 * install project binds version 1 only. The real-Postgres probe proves the
 * concurrent convergence on the actual schema.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { AutomationError, saveVersion } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** Scripted `sql`: the version SELECT answers with the given existing
 * versions; the INSERT echoes what the database would compute. */
function fakeStore(existingVersions: number[]): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const tx = (
    strings: TemplateStringsArray,
    ...values: unknown[]
  ): Promise<unknown[]> => {
    const text = strings.join('?');
    statements.push({ text, values });
    if (text.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (text.includes('SELECT version FROM app.automations')) {
      return Promise.resolve(existingVersions.map((version) => ({ version })));
    }
    if (text.includes('INSERT INTO app.automations')) {
      return Promise.resolve([
        { version: Math.max(0, ...existingVersions) + 1 },
      ]);
    }
    if (text.includes('SELECT id FROM app.projects')) {
      return Promise.resolve([{ id: 'p1' }]);
    }
    return Promise.resolve([]);
  };
  tx.json = (value: unknown): unknown => value;
  const sql = {
    begin: (callback: (handle: typeof tx) => Promise<unknown>) => callback(tx),
  };
  return { sql: sql as unknown as Sql, statements };
}

const args = (overrides: Partial<Parameters<typeof saveVersion>[1]> = {}) => ({
  organizationId: 'org_1',
  name: 'ops/greet',
  document: { version: 1, name: 'ops/greet', nodes: [] },
  actor: 'user_1',
  ...overrides,
});

describe('saveVersion', () => {
  it('takes the per-name advisory lock before reading the version', async () => {
    const fake = fakeStore([1]);
    await saveVersion(fake.sql, args());

    const [lock, read] = fake.statements;
    expect(lock?.text).toContain('pg_advisory_xact_lock');
    expect(lock?.values).toEqual(['org_1', 'ops/greet']);
    expect(read?.text).toContain('SELECT version FROM app.automations');
  });

  it('refuses a create-only save of an existing name with a coded 409 and writes nothing', async () => {
    const fake = fakeStore([1, 2]);
    let caught: unknown;
    try {
      await saveVersion(fake.sql, args({ create: true }));
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(AutomationError);
    if (caught instanceof AutomationError) {
      expect(caught.code).toBe('AUTOMATION_NAME_TAKEN');
      expect(caught.status).toBe(409);
    }
    expect(
      fake.statements.some((statement) =>
        statement.text.includes('INSERT INTO'),
      ),
    ).toBe(false);
  });

  it('creates a fresh name and appends to an existing one without the flag', async () => {
    const fresh = fakeStore([]);
    await expect(
      saveVersion(fresh.sql, args({ create: true })),
    ).resolves.toEqual({ name: 'ops/greet', version: 1 });
    const append = fakeStore([3]);
    await expect(saveVersion(append.sql, args())).resolves.toEqual({
      name: 'ops/greet',
      version: 4,
    });
  });

  it('binds the install project to version 1 only', async () => {
    const first = fakeStore([]);
    await saveVersion(first.sql, args({ projectId: 'p1' }));
    expect(
      first.statements.some((statement) =>
        statement.text.includes('INSERT INTO app.automation_project_bindings'),
      ),
    ).toBe(true);

    const later = fakeStore([1]);
    await saveVersion(later.sql, args({ projectId: 'p1' }));
    expect(
      later.statements.some((statement) =>
        statement.text.includes('INSERT INTO app.automation_project_bindings'),
      ),
    ).toBe(false);
  });
});
