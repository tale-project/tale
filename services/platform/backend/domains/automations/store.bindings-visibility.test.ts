// @vitest-environment node

/**
 * Saving an automation's project bindings on behalf of a person who cannot
 * read every bound project. The editor only ever shows that person the
 * bindings to projects they can read, and posts that set back; replacing
 * the whole set with it silently dropped every hidden binding and could
 * turn a confidential automation into an organization one.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { setAutomationProjects } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

/** A fake driver: bound projects answer the binding read, every project
 * id asked for exists, and each statement (fragments included) is kept
 * with its values. */
function fakeStore(bound: string[]) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('?').replace(/\s+/g, ' ').trim();
    const statement = { text, values };
    statements.push(statement);
    const answer = (async () => {
      if (text.startsWith('SELECT project_id AS "projectId"')) {
        return bound.map((projectId) => ({ projectId }));
      }
      if (text.includes('FROM app.projects')) {
        const ids = values[1];
        return Array.isArray(ids)
          ? ids.map((id) => ({ id, archivedAt: null }))
          : [];
      }
      return [];
    })();
    return Object.assign(answer, { statement });
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  }) as unknown as Sql;
  return { sql, statements };
}

/** The DELETE statement and the visibility fragment it was built with. */
function deletion(statements: Statement[]) {
  const statement = statements.find((row) =>
    row.text.startsWith('DELETE FROM app.automation_project_bindings'),
  );
  const fragment = statement?.values.find(
    (value): value is { statement: Statement } =>
      typeof value === 'object' && value !== null && 'statement' in value,
  )?.statement;
  return { statement, fragment };
}

const base = {
  organizationId: 'org-1',
  name: 'ops/sync',
  actor: 'user-1',
};

beforeEach(() => vi.clearAllMocks());

describe('setAutomationProjects within a partial view', () => {
  it('deletes only bindings the author can read, so a hidden binding survives', async () => {
    const fake = fakeStore(['p-shared', 'p-hidden']);
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: [],
      visibleProjectIds: ['p-shared'],
    });
    const { statement, fragment } = deletion(fake.statements);
    expect(statement?.values).toContainEqual([]);
    expect(fragment).toEqual({
      text: 'AND project_id = ANY(?)',
      values: [['p-shared']],
    });
  });

  it('keeps an already bound hidden project the author sends back without inserting it again', async () => {
    const fake = fakeStore(['p-hidden']);
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: ['p-shared', 'p-hidden'],
      visibleProjectIds: ['p-shared'],
    });
    const inserted = fake.statements
      .filter((row) =>
        row.text.startsWith('INSERT INTO app.automation_project_bindings'),
      )
      .map((row) => row.values[2]);
    expect(inserted).toEqual(['p-shared']);
    expect(deletion(fake.statements).statement?.values).toContainEqual([
      'p-shared',
    ]);
  });

  it('answers a hidden project that is not bound like a missing one, writing nothing', async () => {
    const fake = fakeStore([]);
    await expect(
      setAutomationProjects(fake.sql, {
        ...base,
        projectIds: ['p-hidden'],
        visibleProjectIds: ['p-shared'],
      }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_PROJECT_UNKNOWN',
      status: 404,
    });
    expect(
      fake.statements.filter((row) => /^(INSERT|DELETE)/.test(row.text)),
    ).toEqual([]);
  });

  it('replaces the whole set when no view is given', async () => {
    const fake = fakeStore(['p-hidden']);
    await setAutomationProjects(fake.sql, { ...base, projectIds: [] });
    const { statement, fragment } = deletion(fake.statements);
    expect(statement).toBeDefined();
    expect(fragment?.text).toBe('');
  });
});
