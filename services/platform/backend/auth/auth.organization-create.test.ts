// @vitest-environment node

import type { Sql } from 'postgres';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from './auth.ts';
import { ORGANIZATION_CREATORS_ENV } from './organization-creation-gate.ts';

/**
 * The organization-creation gate is wired into Better Auth's before-hook for
 * `/organization/create`. Its truth table lives in
 * `organization-creation-gate.test.ts`; what these tests hold is the WIRING
 * at the edges the real handler exposes without a database: a caller with no
 * session is answered by the endpoint's own 401, never by the gate's 403, and
 * a deployment without a list never asks the database about organizations.
 * The refusal itself, with a signed-in unlisted caller, is proved against
 * real Postgres in `integration-check.ts`.
 */

/** Every query answers no rows; the text is kept so the gate's reads show. */
function stubSql() {
  const queries: string[] = [];
  const sql = ((strings: TemplateStringsArray) => {
    queries.push(strings.join('?').replaceAll(/\s+/g, ' ').trim());
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, queries };
}

function createRequest() {
  return new Request('https://tale.example.com/api/auth/organization/create', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: 'https://tale.example.com',
    },
    body: JSON.stringify({ name: 'Second Desk', slug: 'second-desk' }),
  });
}

function authWith(sql: Sql) {
  return createAuth({
    databaseUrl: 'postgresql://tale:pw@127.0.0.1:1/tale_app',
    secret: 'test-secret-at-least-16-chars',
    baseUrl: 'https://tale.example.com',
    sql,
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('the organization create route', () => {
  it('leaves a caller without a session to the endpoint (401, not the gate)', async () => {
    vi.stubEnv(ORGANIZATION_CREATORS_ENV, 'ops@example.test');
    const { sql, queries } = stubSql();
    const response = await authWith(sql).handler(createRequest());
    expect(response.status).toBe(401);
    // No session means nothing to judge: the organization probe was not run.
    expect(queries.some((query) => query.includes('"organization"'))).toBe(
      false,
    );
  });

  it('does not consult the deployment at all without a creator list', async () => {
    vi.stubEnv(ORGANIZATION_CREATORS_ENV, undefined);
    const { sql, queries } = stubSql();
    const response = await authWith(sql).handler(createRequest());
    expect(response.status).toBe(401);
    expect(queries.some((query) => query.includes('"organization"'))).toBe(
      false,
    );
  });
});
