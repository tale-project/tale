// @vitest-environment node

import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { createApp } from './app.ts';
import type { Auth } from './auth/auth.ts';

/**
 * The app door's JSON body reader as the REAL app wires it: a synthetic
 * router proves the reader (`lib/app-json-body.test.ts`); only `createApp`
 * proves every `/api/app` route reads through it. The route is the bare
 * `versionSchema.safeParse(await c.req.json())` of
 * `domains/users/routes.ts`, which answered a body-less POST with a
 * reported SyntaxError 500.
 */

function app() {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double: the body is refused before any query
  const sql = (() => Promise.resolve([])) as unknown as Sql;
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const auth = {
    api: {
      getSession: () =>
        Promise.resolve({
          user: { id: 'user-1', email: 'user@example.com', name: 'U' },
          session: { id: 's-1', activeOrganizationId: 'org-1' },
        }),
    },
    options: { baseURL: 'http://localhost' },
    handler: () => Promise.resolve(new Response(null, { status: 404 })),
  } as unknown as Auth;
  return createApp({ sql, auth });
}

describe('app-door JSON bodies through the real app', () => {
  it.each([
    ['an empty body', ''],
    ['a truncated body', '{"version":"0.5'],
  ])('answers %s with 400 INVALID_JSON', async (_name, body) => {
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const res = await app().request(
        'http://localhost/api/app/users/notification-state/toast-shown',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body,
        },
      );
      expect(res.status).toBe(400);
      const id = res.headers.get('x-request-id');
      expect(id).not.toBeNull();
      expect(await res.json()).toEqual({
        error: 'The request body is not valid JSON',
        code: 'INVALID_JSON',
        requestId: id,
      });
      expect(errors).not.toHaveBeenCalled();
    } finally {
      errors.mockRestore();
    }
  });
});
