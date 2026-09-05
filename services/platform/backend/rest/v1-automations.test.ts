// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createAutomationRestRoutes } from './v1-automations.ts';

interface Captured {
  text: string;
  values: unknown[];
}

const project = {
  id: 'p-2',
  organizationId: 'org-1',
  name: 'Ledger',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 0,
  openTaskCount: 0,
  doneTaskCount: 0,
  projectAgentCount: 0,
  teamId: null,
  sharedWithTeamIds: [],
  instructions: null,
  createdBy: 'user-1',
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_000,
  archivedAt: null,
};

/** Tagged-template Sql double for the bind route: one automation version,
 * the visible target project, and the binding INSERT whose `count` says
 * whether the row was new. Records every query. */
function fakeSql(opts: { alreadyBound?: boolean } = {}): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.automations WHERE org_id')) {
      return Promise.resolve([
        {
          version: 1,
          message: null,
          testsPassed: true,
          createdBy: 'user-1',
          createdAt: 1_700_000_000_000,
        },
      ]);
    }
    if (text.includes('FROM "teamMember"')) return Promise.resolve([]);
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([project]);
    }
    if (text.includes('FROM app.projects WHERE org_id')) {
      return Promise.resolve([{ id: project.id }]);
    }
    if (text.startsWith('INSERT INTO app.automation_project_bindings')) {
      return Promise.resolve(
        Object.assign([], { count: opts.alreadyBound ? 0 : 1 }),
      );
    }
    return Promise.resolve([]);
  };
  const unsafe = (text: string) => ({ unsafe: text });
  const begin = (fn: (tx: unknown) => Promise<unknown>) => fn(sql);
  const sql = Object.assign(tag, { unsafe, begin });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { sql: sql as unknown as Sql, queries };
}

function mount(sql: Sql) {
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', 'admin');
    c.set('orgExplicit', true);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  // The family decodes the automation name from the `/api/v1/automations/`
  // prefix, so it is mounted where the door mounts it.
  app.route('/api/v1', createAutomationRestRoutes({ sql }));
  return app;
}

const bind = (sql: Sql) =>
  mount(sql).request(
    'http://localhost/api/v1/automations/invoice-sync/projects',
    {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: project.id }),
    },
  );

/**
 * POST …/projects is ONE atomic add. The regression under test: the route
 * read the current binding set, appended the project and rewrote the whole
 * set through `setAutomationProjects`, whose DELETE dropped every binding
 * not in the passed list — two workers binding different projects at once
 * both answered 201 while the loser's rewrite silently removed the winner's
 * row. The route now goes through `bindProject` (INSERT … ON CONFLICT DO
 * NOTHING): no read-modify-write, no DELETE.
 */
describe('POST /automations/{name}/projects', () => {
  it('answers 400 in the JSON envelope for a malformed body', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request(
      'http://localhost/api/v1/automations/invoice-sync/projects',
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: '{',
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.any(String) });
    expect(
      queries.some((q) =>
        q.text.startsWith('INSERT INTO app.automation_project_bindings'),
      ),
    ).toBe(false);
  });

  it('adds the one binding with an idempotent INSERT and never rewrites the set', async () => {
    const { sql, queries } = fakeSql();
    const res = await bind(sql);
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ name: 'invoice-sync', added: true });
    const insert = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.automation_project_bindings'),
    );
    expect(insert?.text).toContain(
      'ON CONFLICT (org_id, automation_name, project_id) DO NOTHING',
    );
    expect(insert?.values.slice(0, 3)).toEqual([
      'org-1',
      'invoice-sync',
      'p-2',
    ]);
    expect(
      queries.some((q) =>
        q.text.startsWith('DELETE FROM app.automation_project_bindings'),
      ),
    ).toBe(false);
    // No set-derivation read either: the add does not depend on a snapshot.
    expect(
      queries.some((q) =>
        q.text.includes(
          'SELECT project_id AS "projectId" FROM app.automation_project_bindings',
        ),
      ),
    ).toBe(false);
  });

  it('answers 200 added:false for a project already bound', async () => {
    const { sql, queries } = fakeSql({ alreadyBound: true });
    const res = await bind(sql);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ name: 'invoice-sync', added: false });
    expect(
      queries.some((q) =>
        q.text.startsWith('DELETE FROM app.automation_project_bindings'),
      ),
    ).toBe(false);
  });
});
