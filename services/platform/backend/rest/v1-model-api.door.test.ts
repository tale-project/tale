// @vitest-environment node

/**
 * The REST door in front of the model endpoints, wired as the app wires it:
 * the key holder's Bearer key (a revoked or expired key is no key), the
 * organization header a multi-organization key must send, a person's own
 * key the organization blocked, and the refused `x-api-key` — each answered
 * in the wire's own error shape, so an OpenAI or Anthropic SDK reads the
 * refusal where it looks for one.
 */

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import type { Auth } from '../auth/auth.ts';
import {
  modelApiKeyHeaderHint,
  modelApiWireErrors,
} from '../domains/model_api/wire-errors.ts';
import { apiKeyHeaderGuard, restDoorHeaders } from '../lib/http-hygiene.ts';
import { mountRestV1Routes } from './v1.ts';

vi.mock('../auth/auth.ts', () => ({
  API_KEY_RATE_LIMIT: { enabled: false, timeWindow: 60_000, maxRequests: 100 },
  loadTrustedProxies: () => Promise.resolve(['loopback', 'uniquelocal']),
}));

const GOOD_KEY = 'tale_good';
const MULTI_ORG_KEY = 'tale_multi';
/** user-1's own key `key-blocked`, which org-1 blocked (APIKEY-R11). */
const BLOCKED_KEY = 'tale_blocked';

/** Membership answers for the door: user-1 is in org-1; user-2 in two. */
function fakeSql(): Sql {
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    if (text.includes('INSERT INTO app.rate_limits')) {
      return Promise.resolve([{ value: '1' }]);
    }
    if (text.includes('FROM app.rate_limits')) {
      return Promise.resolve([{ value: '0', ts: String(Date.now()) }]);
    }
    if (text.startsWith('SELECT 1 AS one FROM app.api_key_org_blocks')) {
      const [organizationId, keyId] = values;
      return Promise.resolve(
        organizationId === 'org-1' && keyId === 'key-blocked'
          ? [{ one: 1 }]
          : [],
      );
    }
    if (text.startsWith('SELECT o."slug" FROM app.api_key_org_blocks')) {
      return Promise.resolve(
        values[0] === 'key-blocked' ? [{ slug: 'org-1' }] : [],
      );
    }
    const user = values.find(
      (value) => value === 'user-1' || value === 'user-2',
    );
    const orgs = user === 'user-2' ? ['org-1', 'org-2'] : ['org-1'];
    if (text.includes('FROM "member" m JOIN "organization" o')) {
      return Promise.resolve(
        orgs.map((organizationId) => ({
          organizationId,
          role: 'developer',
          name: organizationId,
          slug: organizationId,
        })),
      );
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'org-1' }]);
    }
    if (text.includes('FROM "member" WHERE "organizationId"')) {
      return Promise.resolve([
        {
          id: 'm-1',
          organizationId: 'org-1',
          userId: 'user-1',
          role: 'developer',
        },
      ]);
    }
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve(
        orgs.map((organizationId) => ({ organizationId, role: 'developer' })),
      );
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return tag as unknown as Sql;
}

/** A revoked or expired key verifies as no session. */
function fakeAuth(): Auth {
  const getSession = vi.fn(({ headers }: { headers: Headers }) => {
    const key = headers.get('x-api-key');
    if (key === GOOD_KEY) {
      return Promise.resolve({
        user: { id: 'user-1', email: 'dev@example.com' },
        session: { id: 'key-1' },
      });
    }
    if (key === MULTI_ORG_KEY) {
      return Promise.resolve({
        user: { id: 'user-2', email: 'multi@example.com' },
        session: { id: 'key-2' },
      });
    }
    if (key === BLOCKED_KEY) {
      return Promise.resolve({
        user: { id: 'user-1', email: 'dev@example.com' },
        session: { id: 'key-blocked' },
      });
    }
    return Promise.resolve(null);
  });
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  return { api: { getSession } } as unknown as Auth;
}

/** The app's own wiring of the door (app.ts). */
function app() {
  const root = new Hono();
  root.use('/api/v1/*', restDoorHeaders());
  root.use('/api/v1/openai/*', modelApiWireErrors());
  root.use('/api/v1/anthropic/*', modelApiWireErrors());
  root.use(
    apiKeyHeaderGuard(['x-api-key'], { hintFor: modelApiKeyHeaderHint }),
  );
  mountRestV1Routes(root, { sql: fakeSql(), auth: fakeAuth() });
  return root;
}

describe('the REST door in front of the model endpoints', () => {
  it('refuses a missing key in the OpenAI shape, with the Bearer challenge', async () => {
    const res = await app().request('http://localhost/api/v1/openai/models');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe('Bearer');
    expect(res.headers.get('x-tale-api-version')).not.toBeNull();
    expect(await res.json()).toEqual({
      error: {
        message: 'Missing or invalid Authorization header',
        type: 'authentication_error',
        param: null,
        code: 'UNAUTHORIZED',
      },
    });
  });

  it('refuses a revoked or expired key in the Anthropic shape', async () => {
    const res = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages',
      {
        method: 'POST',
        headers: { authorization: 'Bearer tale_revoked' },
        body: '{}',
      },
    );
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toBe(
      'Bearer error="invalid_token"',
    );
    expect(await res.json()).toEqual({
      type: 'error',
      error: {
        type: 'authentication_error',
        message: 'Invalid API key',
        code: 'UNAUTHORIZED',
      },
    });
  });

  it('asks a multi-organization key for its organization, in the wire’s shape', async () => {
    const res = await app().request(
      'http://localhost/api/v1/openai/chat/completions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${MULTI_ORG_KEY}` },
        body: '{}',
      },
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      error: { type: 'invalid_request_error', code: 'ORG_SLUG_REQUIRED' },
    });
  });

  it('refuses a person’s own key the organization blocked, in either wire’s shape [APIKEY-R11]', async () => {
    const openai = await app().request(
      'http://localhost/api/v1/openai/chat/completions',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${BLOCKED_KEY}` },
        body: '{}',
      },
    );
    expect(openai.status).toBe(403);
    expect(await openai.json()).toEqual({
      error: {
        message:
          'Organization "org-1" has blocked this API key; it works only in the organizations listed.',
        type: 'permission_error',
        param: null,
        code: 'API_KEY_BLOCKED',
      },
    });

    const anthropic = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${BLOCKED_KEY}` },
        body: '{}',
      },
    );
    expect(anthropic.status).toBe(403);
    expect(await anthropic.json()).toMatchObject({
      type: 'error',
      error: { type: 'permission_error', code: 'API_KEY_BLOCKED' },
    });

    // The holder's other key, which no block names, passes the door: what
    // it gets is the model route's own answer.
    const models = await app().request(
      'http://localhost/api/v1/openai/models',
      { headers: { authorization: `Bearer ${GOOD_KEY}` } },
    );
    expect(models.status).not.toBe(401);
    const passed = (await models.json()) as { error?: { code?: string } };
    expect(passed.error?.code).not.toBe('API_KEY_BLOCKED');
  });

  it('refuses x-api-key on the Anthropic endpoint, naming the auth token to use', async () => {
    const res = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages',
      {
        method: 'POST',
        headers: { 'x-api-key': GOOD_KEY },
        body: '{}',
      },
    );
    expect(res.status).toBe(401);
    const body = (await res.json()) as {
      error: { message: string; code: string };
    };
    expect(body.error.code).toBe('UNAUTHORIZED');
    expect(body.error.message).toContain('ANTHROPIC_AUTH_TOKEN');
  });

  it('answers a path the wire does not serve in its shape', async () => {
    const res = await app().request(
      'http://localhost/api/v1/anthropic/v1/messages/count_tokens',
      {
        method: 'POST',
        headers: { authorization: `Bearer ${GOOD_KEY}` },
        body: '{}',
      },
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      type: 'error',
      error: {
        type: 'not_found_error',
        message: 'Not found',
        code: 'NOT_FOUND',
      },
    });
  });
});
