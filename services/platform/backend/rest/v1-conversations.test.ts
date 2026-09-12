// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import type { RestEnv } from './shared.ts';
import { createConversationRestRoutes } from './v1-conversations.ts';

/**
 * The conversations family follows the door's organization rule. The
 * regression under test: every conversation route demanded
 * `X-Organization-Slug` of every key — a single-organization key, which
 * the API reference says may omit the header (and which no route could
 * tell the slug to), was refused with a bare 400 — while a read-only role
 * got `FORBIDDEN` as the whole sentence.
 */

function fakeSql(
  memberOf: string[],
  respond?: (text: string) => object[] | undefined,
): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ..._values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    const scripted = respond?.(text);
    if (scripted !== undefined) return Promise.resolve(scripted);
    if (text.includes('FROM "member" WHERE "userId"')) {
      return Promise.resolve(
        memberOf.map((organizationId) => ({ organizationId, role: 'admin' })),
      );
    }
    if (text.includes('FROM "organization" WHERE "id"')) {
      return Promise.resolve([{ slug: 'acme' }]);
    }
    return Promise.resolve([]);
  };
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
  const sql = Object.assign(tag, {
    unsafe: (t: string) => t,
    begin: (fn: (tx: unknown) => Promise<unknown>) => fn(tag),
  }) as unknown as Sql;
  return { sql, queries };
}

function mount(
  memberOf: string[],
  role = 'admin',
  respond?: (text: string) => object[] | undefined,
) {
  const { sql, queries } = fakeSql(memberOf, respond);
  const app = new Hono<RestEnv>();
  app.use(async (c, next) => {
    c.set('userId', 'user-1');
    c.set('userEmail', 'user@example.com');
    c.set('organizationId', 'org-1');
    c.set('orgSlug', 'acme');
    c.set('role', role);
    c.set('orgExplicit', false);
    c.set('clientIp', '203.0.113.9');
    return next();
  });
  app.route('/', createConversationRestRoutes({ sql }));
  return { app, queries };
}

const STATE =
  'http://localhost/conversations/sync?source=vatplus&externalId=x1';

describe('conversations door — organization rule', () => {
  it('serves a single-organization key that omits the header', async () => {
    const { app } = mount(['org-1']);
    const res = await app.request(STATE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ snapshot: null });
  });

  it('names the role refusal with a code, not as the whole message', async () => {
    const { app } = mount(['org-1'], 'member');
    const res = await app.request(STATE);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({
      error: expect.stringContaining('member'),
      code: 'ROLE_FORBIDDEN',
    });
  });

  it('names the query parameter a refused read is missing', async () => {
    const { app } = mount(['org-1']);
    const res = await app.request(
      'http://localhost/conversations/sync?source=vatplus',
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [expect.objectContaining({ path: 'externalId' })] },
    });
  });
});

/**
 * Every conversations body is strict — a key the schema does not name is
 * refused by name, never dropped (G-25). The snapshot's nested message and
 * attachment objects are held to the same rule.
 */
describe('conversations door — strict bodies', () => {
  const post = (path: string, body: unknown) =>
    mount(['org-1']).app.request(`http://localhost${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });

  it.each([
    [
      '/conversations/deliveries/claim',
      { source: 'vatplus', bogus: 1 },
      'bogus',
    ],
    [
      '/conversations/deliveries/d-1/ack',
      { receiptId: 'r-1', sourceVersion: 2, extra: true },
      'extra',
    ],
    [
      '/conversations/deliveries/d-1/fail',
      {
        claimToken: '11111111-2222-4333-8444-555555555555',
        code: 'network_error',
        permanent: false,
        why: 'x',
      },
      'why',
    ],
    [
      '/conversations/sync',
      {
        source: 'vatplus',
        externalId: 'c1',
        externalContactId: 'k1',
        version: 1,
        subject: 's',
        status: 'open',
        messages: [
          {
            externalId: 'm1',
            content: 'x',
            isCustomer: true,
            authorName: 'A',
            createdAt: 1,
            typo: 'y',
          },
        ],
      },
      'messages.0.typo',
    ],
  ])('%s refuses an unknown key by name', async (path, body, key) => {
    const res = await post(path, body);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({
      code: 'INVALID_BODY',
      error: `invalid body: "${key}" is not a field this body takes`,
    });
  });

  it('reports an over-range version once, not twice', async () => {
    const res = await post('/conversations/sync', {
      source: 'vatplus',
      externalId: 'c1',
      externalContactId: 'k1',
      version: Number.MAX_SAFE_INTEGER + 2,
      subject: 's',
      status: 'open',
      messages: [],
    });
    expect(res.status).toBe(400);
    const body: { data: { issues: { path: string }[] } } = await res.json();
    expect(
      body.data.issues.filter((issue) => issue.path === 'version'),
    ).toHaveLength(1);
  });
});

/**
 * The attachment download tells its two absences apart, like ack and fail
 * do: no claimed delivery under the id is `DELIVERY_NOT_FOUND`; a delivery
 * without an attachment at that position — or a position that is not a
 * whole number in 0..9 — is `ATTACHMENT_NOT_FOUND` (G-16).
 */
describe('GET /conversations/deliveries/{id}/attachments/{index}', () => {
  const delivery = {
    metadata: {
      attachments: [
        {
          storageId: 's3:acme/one',
          filename: 'one.pdf',
          contentType: 'application/pdf',
          size: 3,
        },
      ],
    },
  };
  const get = (index: string, rows: object[]) =>
    mount(['org-1'], 'admin', (text) =>
      text.includes('FROM app.conversation_api_deliveries d')
        ? rows
        : undefined,
    ).app.request(
      `http://localhost/conversations/deliveries/11111111-2222-4333-8444-555555555555/attachments/${index}`,
    );

  it('answers DELIVERY_NOT_FOUND when no claimed delivery is owned under the id', async () => {
    const res = await get('0', []);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Delivery not found',
      code: 'DELIVERY_NOT_FOUND',
    });
  });

  it('answers ATTACHMENT_NOT_FOUND for a position the delivery does not carry', async () => {
    const res = await get('1', [delivery]);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Attachment not found',
      code: 'ATTACHMENT_NOT_FOUND',
    });
  });

  it.each(['-1', 'abc', '1.5', '10'])(
    'answers ATTACHMENT_NOT_FOUND for the malformed position %s',
    async (index) => {
      const res = await get(index, [delivery]);
      expect(res.status).toBe(404);
      expect(await res.json()).toMatchObject({ code: 'ATTACHMENT_NOT_FOUND' });
    },
  );
});
