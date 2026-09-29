// @vitest-environment node

/**
 * The API-key create gate is wired into Better Auth's before-hook for
 * `/api-key/create`. Its truth table lives in `api-key-create-gate.test.ts`;
 * these tests hold the WIRING: the platform's own call and a caller with no
 * session pass to the endpoint untouched, a caller the rule refuses is
 * answered 403 `API_KEY_CREATE_FORBIDDEN` before a key exists, and one it
 * admits goes through.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getSessionFromCtx } = vi.hoisted(() => ({
  getSessionFromCtx: vi.fn(),
}));
vi.mock('better-auth/api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('better-auth/api')>()),
  getSessionFromCtx,
}));

import { createAuth } from './auth.ts';

/** Answers the seat read with one seat in `role`, and no grant. */
function database(role: string) {
  const queries: string[] = [];
  const sql = ((first: unknown) => {
    if (!Array.isArray(first) || !('raw' in first)) return first;
    const text = (first as unknown as TemplateStringsArray)
      .join('?')
      .replaceAll(/\s+/g, ' ')
      .trim();
    queries.push(text);
    if (text.includes('FROM "member"')) {
      return Promise.resolve([{ organizationId: 'o1', role }]);
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, queries };
}

async function runBeforeHook(sql: Sql, overHttp: boolean): Promise<void> {
  const before = createAuth({
    databaseUrl: 'postgresql://tale:pw@127.0.0.1:1/tale_app',
    secret: 'test-secret-at-least-16-chars',
    baseUrl: 'https://tale.example.com',
    sql,
  }).options.hooks?.before;
  if (before === undefined) throw new Error('the before-hook is not wired');
  await before({
    path: '/api-key/create',
    body: { name: 'Mirror' },
    request: overHttp
      ? new Request('https://tale.example.com/api/auth/api-key/create', {
          method: 'POST',
        })
      : undefined,
  } as never);
}

beforeEach(() => {
  getSessionFromCtx.mockReset();
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('the API-key create route', () => {
  it('refuses a member the rule does not admit, before a key exists', async () => {
    getSessionFromCtx.mockResolvedValue({ user: { id: 'u1' } });
    const { sql } = database('member');
    const refusal = await runBeforeHook(sql, true).then(
      () => null,
      (error: unknown) => error,
    );
    expect(refusal).toBeInstanceOf(APIError);
    expect((refusal as APIError).statusCode).toBe(403);
    expect((refusal as APIError).body).toMatchObject({
      code: 'API_KEY_CREATE_FORBIDDEN',
    });
    // The only record of the attempt.
    expect(console.warn).toHaveBeenCalledWith(
      expect.stringContaining('[api-key/create] refused'),
    );
  });

  it('lets a developer through', async () => {
    getSessionFromCtx.mockResolvedValue({ user: { id: 'u1' } });
    await expect(
      runBeforeHook(database('developer').sql, true),
    ).resolves.toBeUndefined();
  });

  it('leaves a caller without a session to the endpoint (401, not the gate)', async () => {
    getSessionFromCtx.mockResolvedValue(null);
    const { sql, queries } = database('member');
    await expect(runBeforeHook(sql, true)).resolves.toBeUndefined();
    expect(queries).toEqual([]);
  });

  it("passes the platform's own call without judging it", async () => {
    const { sql, queries } = database('member');
    await expect(runBeforeHook(sql, false)).resolves.toBeUndefined();
    expect(getSessionFromCtx).not.toHaveBeenCalled();
    expect(queries).toEqual([]);
  });
});
