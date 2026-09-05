// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createTaskRestRoutes } from './v1-tasks.ts';

interface Captured {
  text: string;
  values: unknown[];
}

const project = {
  id: 'p-1',
  organizationId: 'org-1',
  name: 'Ledger',
  description: null,
  icon: null,
  color: null,
  key: null,
  externalItemId: null,
  taskCounter: 1,
  openTaskCount: 1,
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

const task = {
  id: 't-1',
  organizationId: 'org-1',
  projectId: 'p-1',
  title: 'Prepare the Q1 filing',
  labelIds: [],
};

/** Tagged-template Sql double: the visible task and its project, the
 * limiter's UPSERT (spent or not), empty elsewhere; records every query. */
function fakeSql(opts: { spent?: boolean } = {}): {
  sql: Sql;
  queries: Captured[];
} {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM "teamMember"')) return Promise.resolve([]);
    if (text.includes('FROM app.tasks WHERE id')) return Promise.resolve([task]);
    if (text.includes('FROM app.projects WHERE id')) {
      return Promise.resolve([project]);
    }
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve(opts.spent ? [] : [{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
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
  app.route('/', createTaskRestRoutes({ sql }));
  return app;
}

/**
 * POST …/comments passes the per-user `task:comment` budget its in-app twin
 * passes — the spec promised it while the route charged only the general
 * lane. The key acts as its user, so the budget is the key holder's.
 */
describe('POST /tasks/{id}/comments task:comment budget', () => {
  it('answers the standard 429 with Retry-After when the budget is spent, writing nothing', async () => {
    const { sql, queries } = fakeSql({ spent: true });
    const res = await mount(sql).request('http://localhost/tasks/t-1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Filed.' }),
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('retry-after'))).toBeGreaterThanOrEqual(1);
    expect(await res.json()).toMatchObject({ error: 'RATE_LIMITED' });
    const charge = queries.find((q) =>
      q.text.includes('INSERT INTO app.rate_limits'),
    );
    expect(charge?.values).toContain('task:comment');
    expect(charge?.values).toContain('user:user-1');
    expect(queries.some((q) => q.text.startsWith('INSERT INTO app.messages'))).toBe(false);
  });

  it('charges only after the task proved visible, so an unknown task stays an opaque 404', async () => {
    const { sql, queries } = fakeSql({ spent: true });
    const res = await mount(sql).request('http://localhost/tasks/t-1/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ body: 'Filed.' }),
    });
    expect(res.status).toBe(429);
    const order = queries.map((q) => q.text);
    const taskAt = order.findIndex((t) => t.includes('FROM app.tasks WHERE id'));
    const chargeAt = order.findIndex((t) => t.includes('INSERT INTO app.rate_limits'));
    expect(taskAt).toBeGreaterThanOrEqual(0);
    expect(chargeAt).toBeGreaterThan(taskAt);
  });
});
