// @vitest-environment node

/**
 * The automation reads that answer as their caller sees them (#5201): the
 * run listings and the catalog listings join the projects the caller may
 * read, archived ones included (`readableProjectsSql`), in the statement
 * that reads their rows — never the caller's project ids read first and
 * sent back as a list. The store's own functions run here against a
 * scripted `sql` that inlines nested fragments the way postgres.js does,
 * so the statement Postgres would see is under test; the real-Postgres
 * lane (`checkAutomationProjectVisibility` in `integration-check.ts`)
 * reads real rows back.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { ProjectAuthContext } from '../projects/service.ts';
import { visibleInstallations } from './project-visibility.ts';
import {
  listAutomations,
  listAutomationsForApp,
  listRuns,
  listRunsPage,
} from './store.ts';

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

/** A scripted `sql` that inlines nested fragments the way postgres.js
 *  does and records every statement; a statement answers the rows of the
 *  first answer whose prefix it starts with, and none otherwise. */
function scripted(answers: [prefix: string, rows: object[]][] = []): {
  sql: Sql;
  statements: Statement[];
} {
  const statements: Statement[] = [];
  const statement = (text: string, values: unknown[]) => {
    statements.push({ text, values });
    const rows = answers.find(([prefix]) => text.startsWith(prefix))?.[1] ?? [];
    const fragment: Fragment = { [FRAGMENT]: true, text, values };
    return Object.assign(Promise.resolve(rows), fragment);
  };
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
    return statement(text.replaceAll(/\s+/g, ' ').trim(), flat);
  };
  const sql = Object.assign(tag, {
    unsafe: (text: string) =>
      statement(text.replaceAll(/\s+/g, ' ').trim(), []),
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- a scripted tagged template standing in for postgres.js
  return { sql: sql as unknown as Sql, statements };
}

/** The project audience: its teams, with the legacy pair's fallback. */
const TEAMS =
  'CASE WHEN cardinality(team_ids) > 0 THEN team_ids ELSE array_remove(ARRAY[team_id] || shared_with_team_ids, NULL) END';
/** The projects the reader may read (`readableProjectsSql`), inlined. */
const RELATION = `( SELECT id AS project_id, key AS project_key, archived_at_ms AS project_archived_at_ms FROM app.projects WHERE org_id = ? AND ? AND (? OR archived_at_ms IS NULL) AND (? OR cardinality(${TEAMS}) = 0 OR ${TEAMS} && ?::text[]) )`;
const READABLE_RUNS = `AND (project_id IS NULL OR project_id IN ( SELECT rp.project_id FROM ${RELATION} rp))`;
const INSTALLATIONS = `SELECT b.automation_name AS "automationName", b.project_id AS "projectId", rp.project_id IS NOT NULL AS readable FROM app.automation_project_bindings b LEFT JOIN ${RELATION} rp ON rp.project_id = b.project_id WHERE b.org_id = ?`;

const owner: ProjectAuthContext = {
  organizationId: 'org_1',
  userId: 'user_ada',
  role: 'owner',
  teamIds: [],
};
const member: ProjectAuthContext = {
  organizationId: 'org_1',
  userId: 'user_mia',
  role: 'member',
  teamIds: ['team_finance'],
};
const disabled: ProjectAuthContext = { ...member, role: 'disabled' };

/** The run reads among the recorded statements. */
function runReads(statements: Statement[]): Statement[] {
  return statements.filter(({ text }) =>
    text.includes('FROM app.automation_runs WHERE org_id = ?'),
  );
}

describe('the run listings join the projects the caller may read [AUTO-R2]', () => {
  // Org · name twice · project scope twice, then the relation's grant:
  // org · not a disabled seat · archived projects kept · admin · teams.
  it('reads an owner’s runs of every project of the organization, archived ones too [PROJ-R1]', async () => {
    const { sql, statements } = scripted();
    await listRuns(sql, 'org_1', { name: 'ops/nightly', viewer: owner });
    const [select] = runReads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.text).not.toContain('project_id = ANY(');
    expect(select?.values.slice(0, 10)).toEqual([
      'org_1',
      'ops/nightly',
      'ops/nightly',
      true,
      null,
      'org_1',
      true,
      true,
      true,
      [],
    ]);
  });

  it('reads a member’s runs of projects open to the organization or shared with a team of theirs, page by page [PROJ-R2]', async () => {
    const { sql, statements } = scripted();
    await listRunsPage(sql, 'org_1', { viewer: member, limit: 25 });
    const [select] = runReads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.text).not.toContain('project_id = ANY(');
    expect(select?.values.slice(5, 10)).toEqual([
      'org_1',
      true,
      true,
      false,
      ['team_finance'],
    ]);
  });

  it('gives a disabled seat the organization’s runs and no project’s [PROJ-R2]', async () => {
    const { sql, statements } = scripted();
    await listRuns(sql, 'org_1', { viewer: disabled });
    const [select] = runReads(statements);
    expect(select?.text).toContain(READABLE_RUNS);
    expect(select?.values.slice(5, 7)).toEqual(['org_1', false]);
  });

  it('reads every run when no caller is named, as the internal listings do', async () => {
    const { sql, statements } = scripted();
    await listRuns(sql, 'org_1', { name: 'ops/nightly' });
    const [select] = runReads(statements);
    expect(select?.text).not.toContain('app.projects');
  });
});

describe('the catalog listings join the projects the caller may read [AUTO-R27]', () => {
  /** Three automations: one installed in a project the caller reads and
   * one they do not, one installed only where they cannot read, one of
   * the organization. The join answers which installation is readable,
   * as Postgres answers it for the caller. */
  const catalog = (readable: (projectId: string) => boolean) =>
    scripted([
      [
        'SELECT a.name',
        ['billing/dunning', 'hr/onboarding', 'ops/org'].map((name) => ({
          name,
          latestVersion: 1,
          latest: 1,
          deployedVersion: null,
        })),
      ],
      [
        'SELECT b.automation_name',
        [
          ['billing/dunning', 'p-finance'],
          ['billing/dunning', 'p-hr'],
          ['hr/onboarding', 'p-hr'],
        ].map(([automationName, projectId = '']) => ({
          automationName,
          projectId,
          readable: readable(projectId),
        })),
      ],
    ]);

  const installations = (rows: { name: string; projectIds: string[] }[]) =>
    rows.map(({ name, projectIds }) => [name, projectIds]);

  it('lists a member’s readable installations, leaving out an automation installed only where they cannot read [PROJ-R2]', async () => {
    const { sql, statements } = catalog((id) => id === 'p-finance');
    const rows = await listAutomations(sql, 'org_1', { viewer: member });
    expect(installations(rows)).toEqual([
      ['billing/dunning', ['p-finance']],
      ['ops/org', []],
    ]);
    const join = statements.find(({ text }) => text === INSTALLATIONS);
    expect(join?.values).toEqual([
      'org_1',
      true,
      true,
      false,
      ['team_finance'],
      'org_1',
    ]);
    expect(
      statements.some(({ text }) => text.includes('project_id = ANY(')),
    ).toBe(false);
  });

  it('lists every installation of an owner [PROJ-R1]', async () => {
    const { sql, statements } = catalog(() => true);
    const rows = await listAutomations(sql, 'org_1', { viewer: owner });
    expect(installations(rows)).toEqual([
      ['billing/dunning', ['p-finance', 'p-hr']],
      ['hr/onboarding', ['p-hr']],
      ['ops/org', []],
    ]);
    expect(
      statements.find(({ text }) => text === INSTALLATIONS)?.values,
    ).toEqual(['org_1', true, true, true, [], 'org_1']);
  });

  it('gives a disabled seat the organization’s automations alone [PROJ-R2]', async () => {
    const { sql, statements } = catalog(() => false);
    const rows = await listAutomations(sql, 'org_1', { viewer: disabled });
    expect(installations(rows)).toEqual([['ops/org', []]]);
    expect(
      statements.find(({ text }) => text === INSTALLATIONS)?.values.slice(0, 2),
    ).toEqual(['org_1', false]);
  });

  it('scopes the app’s list to the installations the member reads [AUTO-R2]', async () => {
    const readable = (id: string) => id === 'p-finance';
    const list = async (options: {
      projectId?: string;
      includeProjectBound?: boolean;
    }) =>
      installations(
        await listAutomationsForApp(catalog(readable).sql, 'org_1', {
          ...options,
          viewer: member,
        }),
      );
    expect(await list({ includeProjectBound: true })).toEqual([
      ['billing/dunning', ['p-finance']],
      ['ops/org', []],
    ]);
    expect(await list({ projectId: 'p-finance' })).toEqual([
      ['billing/dunning', ['p-finance']],
    ]);
    // Installed there, but not where she reads: nothing of it is listed.
    expect(await list({ projectId: 'p-hr' })).toEqual([]);
    expect(await list({})).toEqual([['ops/org', []]]);
  });

  it('lists every automation with every installation when no caller is named', async () => {
    const { sql, statements } = scripted([
      ['SELECT a.name', [{ name: 'hr/onboarding', latestVersion: 1 }]],
      [
        'SELECT automation_name',
        [{ automationName: 'hr/onboarding', projectId: 'p-hr' }],
      ],
    ]);
    const rows = await listAutomations(sql, 'org_1');
    expect(installations(rows)).toEqual([['hr/onboarding', ['p-hr']]]);
    expect(statements.some(({ text }) => text.includes('app.projects'))).toBe(
      false,
    );
  });
});

describe('visibleInstallations', () => {
  it('asks for the installations alone and keeps their order [PROJ-R2]', async () => {
    const { sql, statements } = scripted([
      ['SELECT id FROM app.projects', [{ id: 'p-2' }, { id: 'p-1' }]],
    ]);
    expect(
      await visibleInstallations(sql, member, ['p-1', 'p-3', 'p-2']),
    ).toEqual(['p-1', 'p-2']);
    const check = statements.find(({ text }) =>
      text.startsWith('SELECT id FROM app.projects'),
    );
    expect(check?.values).toEqual([
      'org_1',
      ['p-1', 'p-3', 'p-2'],
      false,
      ['team_finance'],
    ]);
  });

  it('asks nothing for a disabled seat or an automation installed nowhere [PROJ-R2]', async () => {
    const { sql, statements } = scripted();
    expect(await visibleInstallations(sql, disabled, ['p-1'])).toEqual([]);
    expect(await visibleInstallations(sql, member, [])).toEqual([]);
    expect(statements).toEqual([]);
  });
});
