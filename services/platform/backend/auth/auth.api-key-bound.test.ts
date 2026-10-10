// @vitest-environment node

/**
 * A key bound to one organization — one an Owner or Admin made for a
 * member — is that organization's to change: the api-key plugin's own
 * `/api-key/update` and `/api-key/delete` refuse it over HTTP, so its holder
 * can neither stretch its expiry nor end it outside the organization's
 * door, which stamps the binding and writes the trail there. A person's own
 * key passes untouched, and so does the platform's own call.
 */

import { APIError } from 'better-auth/api';
import type { Sql } from 'postgres';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createAuth } from './auth.ts';

/** Answers the binding read: `bound` names the keys that have one. */
function database(bound: string[]) {
  const queries: string[] = [];
  const sql = ((first: unknown, ...values: unknown[]) => {
    if (!Array.isArray(first) || !('raw' in first)) return first;
    const text = (first as unknown as TemplateStringsArray)
      .join('?')
      .replaceAll(/\s+/g, ' ')
      .trim();
    queries.push(text);
    if (text.includes('FROM app.api_key_owners WHERE api_key_id')) {
      const keyId = String(values[0]);
      return Promise.resolve(
        bound.includes(keyId)
          ? [
              {
                apiKeyId: keyId,
                organizationId: 'o1',
                kind: 'member',
                principalUserId: 'u1',
                teamId: null,
                projectId: null,
                role: null,
                name: 'Billing sync',
                createdBy: 'admin-1',
                createdAt: '1',
                revokedAt: null,
                revokedBy: null,
              },
            ]
          : [],
      );
    }
    return Promise.resolve([]);
  }) as unknown as Sql;
  return { sql, queries };
}

async function runBeforeHook(
  sql: Sql,
  path: '/api-key/update' | '/api-key/delete',
  overHttp: boolean,
): Promise<void> {
  const before = createAuth({
    databaseUrl: 'postgresql://tale:pw@127.0.0.1:1/tale_app',
    secret: 'test-secret-at-least-16-chars',
    baseUrl: 'https://tale.example.com',
    sql,
  }).options.hooks?.before;
  if (before === undefined) throw new Error('the before-hook is not wired');
  await before({
    path,
    body: { keyId: 'key-1', expiresIn: 365 * 86_400 },
    request: overHttp
      ? new Request(`https://tale.example.com/api/auth${path}`, {
          method: 'POST',
        })
      : undefined,
  } as never);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('a key bound to an organization at the api-key plugin’s door', () => {
  it.each(['/api-key/update', '/api-key/delete'] as const)(
    'refuses %s of it over HTTP [APIKEY-R8]',
    async (path) => {
      const refusal = await runBeforeHook(
        database(['key-1']).sql,
        path,
        true,
      ).then(
        () => null,
        (error: unknown) => error,
      );
      expect(refusal).toBeInstanceOf(APIError);
      expect((refusal as APIError).statusCode).toBe(403);
      expect((refusal as APIError).body).toMatchObject({
        code: 'API_KEY_ORGANIZATION_MANAGED',
      });
    },
  );

  it('lets a person’s own key through', async () => {
    await expect(
      runBeforeHook(database([]).sql, '/api-key/delete', true),
    ).resolves.toBeUndefined();
  });

  it('passes the platform’s own call without reading the binding', async () => {
    const { sql, queries } = database(['key-1']);
    await expect(
      runBeforeHook(sql, '/api-key/delete', false),
    ).resolves.toBeUndefined();
    expect(
      queries.filter((text) => text.includes('app.api_key_owners')),
    ).toEqual([]);
  });
});
