// @vitest-environment node

/**
 * Unit lock for the project-binding doors' half of AUTO-R29 (#4540). The
 * database keeps the wake claim itself (migration 0168's binding and trigger
 * triggers), so a door's duties are: the audit chain, then automation's name lock; for a
 * binding change, its claim keys before any binding write — one call to
 * `app.lock_automation_wake_keys`, which takes the fence and, only for a
 * claiming schedule, the projects in order (R4-F3, R5-F1); and a second
 * claim, refused by the one-wake index, answers 409 and writes nothing after
 * it. The real-Postgres races are `checkStandingRoleWakeScenarios`
 * (W20–W27).
 */

import type { Sql, TransactionSql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

// Definition audit payloads have their own maintained suite; keep the
// actual audit/name locks here while this fake handles binding statements.
vi.mock('./audit.ts', () => ({
  auditDefinitionWrite: vi.fn(async () => undefined),
  listDeployments: vi.fn(async () => []),
}));

import {
  AutomationError,
  bindProjectInTx,
  saveVersion,
  setAutomationProjects,
} from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const oneWakeConflict = () =>
  Object.assign(new Error('duplicate key value'), {
    code: '23505',
    constraint_name: 'automation_project_bindings_one_wake',
  });

/** A fake driver: every asked-for project exists, and the binding insert
 * for `failOn` raises the one-wake conflict. */
function fakeStore(options: { failOn?: string } = {}) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    statements.push({ text, values });
    if (text.includes('pg_advisory_xact_lock')) return Promise.resolve([]);
    if (text.includes('SELECT max(version)')) {
      return Promise.resolve([{ latest: null }]);
    }
    if (text.includes('INSERT INTO app.automations ')) {
      return Promise.resolve([{ version: 1 }]);
    }
    if (text.includes('FROM app.projects')) {
      const ids = values.find(Array.isArray);
      return Promise.resolve(
        Array.isArray(ids)
          ? ids.map((id) => ({ id, archivedAt: null }))
          : [{ id: values[1], archivedAt: null }],
      );
    }
    if (text.startsWith('INSERT INTO app.automation_project_bindings')) {
      if (options.failOn !== undefined && values[2] === options.failOn) {
        return Promise.reject(oneWakeConflict());
      }
      return Promise.resolve(Object.assign([], { count: 1 }));
    }
    return Promise.resolve(Object.assign([], { count: 0 }));
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  });
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a stand-in for the postgres.js template function
    sql: sql as unknown as Sql,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the same stand-in as a transaction handle
    tx: sql as unknown as TransactionSql,
    statements,
  };
}

const inserts = (statements: Statement[]) =>
  statements.filter((row) =>
    row.text.startsWith('INSERT INTO app.automation_project_bindings'),
  );

const base = { organizationId: 'org-1', name: 'ops/manager', actor: 'user-1' };

describe('binding doors and the database-kept wake claim (#4540) [AUTO-R29]', () => {
  it('setAutomationProjects takes audit then name locks, then its claim keys for every asked-for project, before any binding write', async () => {
    const fake = fakeStore();
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: ['p-2', 'p-1'],
    });
    const texts = fake.statements.map((row) => row.text);
    expect(fake.statements[0]?.values).toContain('audit-chain:org-1');
    expect(fake.statements[1]?.text).toContain("'automation:'");
    const keys = fake.statements.findIndex((row) =>
      row.text.includes('app.lock_automation_wake_keys'),
    );
    const firstWrite = texts.findIndex((text) => /^(INSERT|DELETE)/.test(text));
    expect(keys).toBeGreaterThan(0);
    expect(keys).toBeLessThan(firstWrite);
    // The database adds the projects bound now and sorts; the door passes
    // what it asks for, and takes no project key of its own.
    expect(fake.statements[keys]?.values).toEqual([
      'org-1',
      'ops/manager',
      ['p-2', 'p-1'],
    ]);
    expect(texts.some((text) => text.includes('app.lock_project_wake'))).toBe(
      false,
    );
    expect(inserts(fake.statements).map((row) => row.values[2])).toEqual([
      'p-1',
      'p-2',
    ]);
  });

  it('setAutomationProjects answers a second claim with 409 and binds nothing after it', async () => {
    const fake = fakeStore({ failOn: 'p-1' });
    const refused = await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: ['p-2', 'p-1'],
    }).catch((error: unknown) => error);
    expect(refused).toBeInstanceOf(AutomationError);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      status: 409,
    });
    expect(inserts(fake.statements).map((row) => row.values[2])).toEqual([
      'p-1',
    ]);
  });

  it('leaves the claim to the database: no door writes the wakes column', async () => {
    const fake = fakeStore();
    await setAutomationProjects(fake.sql, { ...base, projectIds: ['p-1'] });
    expect(inserts(fake.statements)[0]?.text).not.toContain('wakes');
  });

  it('bindProjectInTx takes the audit chain then name and claim keys and answers a second claim with 409', async () => {
    const fake = fakeStore({ failOn: 'p-3' });
    const refused = await bindProjectInTx(fake.tx, {
      ...base,
      projectId: 'p-3',
    }).catch((error: unknown) => error);
    expect(fake.statements[0]?.values).toContain('audit-chain:org-1');
    expect(fake.statements[1]?.text).toContain("'automation:'");
    expect(fake.statements[2]?.text).toContain('app.lock_automation_wake_keys');
    expect(refused).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      status: 409,
    });
  });

  it('saveVersion answers a second claim on its first binding with 409', async () => {
    const fake = fakeStore({ failOn: 'p-1' });
    const refused = await saveVersion(fake.sql, {
      organizationId: 'org-1',
      name: 'ops/manager',
      document: { version: 1, name: 'ops/manager', nodes: [] },
      actor: 'user-1',
      projectId: 'p-1',
      create: true,
    }).catch((error: unknown) => error);
    expect(refused).toMatchObject({
      code: 'AUTOMATION_TRIGGER_INVALID',
      status: 409,
    });
  });
});
