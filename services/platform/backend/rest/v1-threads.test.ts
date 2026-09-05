// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createThreadRestRoutes } from './v1-threads.ts';

interface Captured {
  text: string;
  values: unknown[];
}

const thread = {
  id: 't-1',
  title: 'Refunds',
  kind: 'direct',
  agentSlug: null,
  harness: null,
  projectId: null,
  archived: false,
  isShared: null,
  createdAt: 1_700_000_000_000,
  updatedAt: 1_700_000_000_001,
};

/** Tagged-template Sql double: the caller's thread for the loader, empty
 * elsewhere; records every query. `begin` runs the callback on the same
 * tag, so a domain transaction is captured like a plain query. */
function fakeSql(): { sql: Sql; queries: Captured[] } {
  const queries: Captured[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push({ text, values });
    if (text.includes('FROM app.threads t') && text.includes('t.id = $?')) {
      return Promise.resolve([thread]);
    }
    if (text.startsWith('INSERT INTO app.threads')) {
      return Promise.resolve([{ id: 't-new' }]);
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
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createThreadRestRoutes({ sql }));
  return app;
}

/**
 * GET …/messages bounds its page through the shared `pageLimit`. The
 * regression under test: the route clamped without truncating, so
 * `?limit=2.5` shipped to Postgres as `3.5` and `int8in` refused it — a
 * 500 for a malformed query string.
 */
describe('GET /threads/{id}/messages limit', () => {
  it.each([
    ['2.5', 3],
    ['-4', 2],
    ['999', 101],
    ['abc', 26],
  ])(
    'turns ?limit=%s into a whole LIMIT of %i (page + 1)',
    async (limit, expected) => {
      const { sql, queries } = fakeSql();
      const res = await mount(sql).request(
        `http://localhost/threads/t-1/messages?limit=${limit}`,
      );
      expect(res.status).toBe(200);
      const page = queries.find((q) => q.text.includes('FROM app.messages'));
      expect(page?.values).toContain(expected);
    },
  );
});

/**
 * POST /threads forwards the documented `agentSlug`. The regression under
 * test: the create schema declared only title and projectId, and zod strips
 * unknown keys — a consumer pinning an agent got a 201 and a thread whose
 * `agent_slug` was NULL, so every turn ran as the default assistant with no
 * signal that the pin was dropped.
 */
describe('POST /threads agentSlug', () => {
  it('writes the agent pin into the thread metadata', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Refunds', agentSlug: 'triage-bot' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ id: 't-new' });
    const metadata = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.thread_metadata'),
    );
    expect(metadata?.values).toContain('triage-bot');
  });

  it('leaves the pin NULL when the consumer sends none', async () => {
    const { sql, queries } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(201);
    const metadata = queries.find((q) =>
      q.text.startsWith('INSERT INTO app.thread_metadata'),
    );
    // (…, project_id, agent_slug, harness, …) — the slug slot is null.
    expect(metadata?.values[6]).toBeNull();
  });

  it('refuses an empty agentSlug', async () => {
    const { sql } = fakeSql();
    const res = await mount(sql).request('http://localhost/threads', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ agentSlug: '' }),
    });
    expect(res.status).toBe(400);
  });
});
