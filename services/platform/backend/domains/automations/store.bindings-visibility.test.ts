// @vitest-environment node

/**
 * Saving an automation's project bindings on behalf of a person who cannot
 * read every bound project. The editor only ever shows that person the
 * bindings to projects they can read, and posts that set back; replacing
 * the whole set with it silently dropped every hidden binding and could
 * turn a confidential automation into an organization one. The projects
 * the person may read join the DELETE, and the named ones are asked alone
 * (#5201): no statement carries every project id they can read.
 */

import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { appOrigin } from '../../lib/write-origin.ts';
import type { ProjectAuthContext } from '../projects/service.ts';
import { setAutomationProjects } from './store.ts';

interface Statement {
  text: string;
  values: unknown[];
}

const FRAGMENT = Symbol('fragment');
interface Fragment extends Statement {
  [FRAGMENT]: true;
}

function isFragment(value: unknown): value is Fragment {
  return (
    typeof value === 'object' &&
    value !== null &&
    (value as { [FRAGMENT]?: true })[FRAGMENT] === true
  );
}

/** A fake driver that inlines nested fragments the way postgres.js does:
 * bound projects answer the binding read, the person reads the `readable`
 * projects among those asked, every project id asked for exists, and each
 * statement (fragments included) is kept with its values. */
function fakeStore(bound: string[], readable: string[] = []) {
  const statements: Statement[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    let text = '';
    const flat: unknown[] = [];
    strings.forEach((part, index) => {
      text += part;
      if (index >= values.length) return;
      const value = values[index];
      if (isFragment(value)) {
        text += value.text;
        flat.push(...value.values);
      } else {
        text += '?';
        flat.push(value);
      }
    });
    text = text.replace(/\s+/g, ' ').trim();
    statements.push({ text, values: flat });
    const asked = Array.isArray(flat[1]) ? flat[1].map(String) : [];
    const answer = (async () => {
      if (text.startsWith('SELECT project_id AS "projectId"')) {
        return bound.map((projectId) => ({ projectId }));
      }
      if (text.startsWith('SELECT id FROM app.projects')) {
        return asked
          .filter((id) => readable.includes(id))
          .map((id) => ({ id }));
      }
      if (text.includes('FROM app.projects')) {
        return asked.map((id) => ({ id, archivedAt: null }));
      }
      return [];
    })();
    const fragment: Fragment = { [FRAGMENT]: true, text, values: flat };
    return Object.assign(answer, fragment);
  };
  const sql = Object.assign(tag, {
    json: (value: unknown) => value,
    begin: (callback: (tx: typeof tag) => Promise<unknown>) => callback(tag),
  }) as unknown as Sql;
  return { sql, statements };
}

/** The DELETE statement, its visibility fragment inlined. */
function deletion(statements: Statement[]) {
  return statements.find((row) =>
    row.text.startsWith('DELETE FROM app.automation_project_bindings'),
  );
}

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
/** The projects the person may read (`readableProjectsSql`), inlined. */
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;
const READABLE_ONLY = `AND NOT (project_id = ANY(?)) AND project_id IN ( SELECT rp.project_id FROM ${RELATION} rp ) RETURNING`;

const owner: ProjectAuthContext = {
  organizationId: 'org-1',
  userId: 'user-ada',
  role: 'owner',
  teamIds: [],
};
const member: ProjectAuthContext = {
  organizationId: 'org-1',
  userId: 'user-mia',
  role: 'member',
  teamIds: ['team-ops'],
};

const base = {
  organizationId: 'org-1',
  name: 'ops/sync',
  origin: appOrigin('user-1'),
};

beforeEach(() => vi.clearAllMocks());

describe('setAutomationProjects within a partial view', () => {
  it('deletes only bindings the author can read, so a hidden binding survives [PROJ-R2]', async () => {
    const fake = fakeStore(['p-shared', 'p-hidden'], ['p-shared']);
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: [],
      viewer: member,
    });
    const statement = deletion(fake.statements);
    expect(statement?.text).toContain(READABLE_ONLY);
    // Org · name · the kept set · then the relation: org · not a disabled
    // seat · archived projects kept · admin · teams.
    expect(statement?.values).toEqual([
      'org-1',
      'ops/sync',
      [],
      'org-1',
      true,
      true,
      false,
      ['team-ops'],
    ]);
  });

  it('keeps an already bound hidden project the author sends back without inserting it again', async () => {
    const fake = fakeStore(['p-hidden'], ['p-shared']);
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: ['p-shared', 'p-hidden'],
      viewer: member,
    });
    // The named projects are asked alone, never every project the author
    // reads.
    expect(
      fake.statements
        .filter((row) => row.text.startsWith('SELECT id FROM app.projects'))
        .map((row) => row.values[1]),
    ).toEqual([['p-shared', 'p-hidden']]);
    const inserted = fake.statements
      .filter((row) =>
        row.text.startsWith('INSERT INTO app.automation_project_bindings'),
      )
      .map((row) => row.values[2]);
    expect(inserted).toEqual(['p-shared']);
    expect(deletion(fake.statements)?.values).toContainEqual(['p-shared']);
  });

  it('answers a hidden project that is not bound like a missing one, writing nothing', async () => {
    const fake = fakeStore([], ['p-shared']);
    await expect(
      setAutomationProjects(fake.sql, {
        ...base,
        projectIds: ['p-hidden'],
        viewer: member,
      }),
    ).rejects.toMatchObject({
      code: 'AUTOMATION_PROJECT_UNKNOWN',
      status: 404,
    });
    expect(
      fake.statements.filter((row) => /^(INSERT|DELETE)/.test(row.text)),
    ).toEqual([]);
  });

  it('lets an owner replace the bindings of every project of the organization [PROJ-R1]', async () => {
    const fake = fakeStore(['p-finance'], ['p-finance', 'p-legal']);
    await setAutomationProjects(fake.sql, {
      ...base,
      projectIds: ['p-legal'],
      viewer: owner,
    });
    const statement = deletion(fake.statements);
    expect(statement?.text).toContain(READABLE_ONLY);
    expect(statement?.values).toEqual([
      'org-1',
      'ops/sync',
      ['p-legal'],
      'org-1',
      true,
      true,
      true,
      [],
    ]);
  });

  it('gives a disabled seat no binding to add or remove [PROJ-R2]', async () => {
    const fake = fakeStore(['p-shared'], ['p-shared']);
    await expect(
      setAutomationProjects(fake.sql, {
        ...base,
        projectIds: ['p-other'],
        viewer: { ...member, role: 'disabled' },
      }),
    ).rejects.toMatchObject({ code: 'AUTOMATION_PROJECT_UNKNOWN' });
    // Nothing is asked about the projects, and the relation reads none.
    const empty = fakeStore(['p-shared'], ['p-shared']);
    await setAutomationProjects(empty.sql, {
      ...base,
      projectIds: [],
      viewer: { ...member, role: 'disabled' },
    });
    expect(
      empty.statements.some((row) =>
        row.text.startsWith('SELECT id FROM app.projects'),
      ),
    ).toBe(false);
    expect(deletion(empty.statements)?.values.slice(3, 5)).toEqual([
      'org-1',
      false,
    ]);
  });

  it('replaces the whole set when no view is given', async () => {
    const fake = fakeStore(['p-hidden']);
    await setAutomationProjects(fake.sql, { ...base, projectIds: [] });
    const statement = deletion(fake.statements);
    expect(statement?.text).toContain(
      'AND NOT (project_id = ANY(?)) RETURNING',
    );
    expect(statement?.values).toEqual(['org-1', 'ops/sync', []]);
  });
});
