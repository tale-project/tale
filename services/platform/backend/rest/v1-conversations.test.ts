// @vitest-environment node

import { Hono } from 'hono';
import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

import { mintCursorFor, type RestEnv } from './shared.ts';
import { createConversationRestRoutes } from './v1-conversations.ts';

// The retry's audit row and realtime hint are the domain's business; the
// door test proves the route's own answers.
vi.mock('../domains/audit_logs/service.ts', () => ({
  createAuditLog: vi.fn(),
}));
vi.mock('../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));
vi.mock('../domains/collab/service.ts', () => ({
  notifyConversationAssigned: vi.fn(),
  notifyConversationAssignedTeam: vi.fn(),
}));

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
  respond?: (text: string, values: unknown[]) => object[] | undefined,
): { sql: Sql; queries: string[] } {
  const queries: string[] = [];
  const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join('$?').replace(/\s+/g, ' ').trim();
    queries.push(text);
    const scripted = respond?.(text, values);
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
  respond?: (text: string, values: unknown[]) => object[] | undefined,
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

/**
 * The queue is readable without claiming (G-03a): `GET /conversations/
 * deliveries?source=` lists a source's deliveries with a derived status
 * and no claim token, paginated like the other lists; `status` takes the
 * four states only, and a blank cursor is refused like everywhere.
 */
describe('GET /conversations', () => {
  const row = {
    conversationId: 'c-1',
    externalId: 'x-1',
    externalContactId: 'crm-1',
    contactId: 'ct-1',
    contactStatus: 'trashed',
    version: 3,
    sourceDeleted: false,
    status: 'open',
    subject: 'Invoice 12',
    createdAt: 1_700_000_000_000,
  };
  const list = (rows: object[] = [row]) =>
    mount(['org-1'], 'admin', (text) =>
      text.includes('FROM app.conversation_api_bindings') &&
      text.includes('bool_or')
        ? [{ owned: true }]
        : text.includes('WITH mirrored AS')
          ? rows
          : undefined,
    );

  it('answers the mirrors under the source, newest first, in the page envelope', async () => {
    // The reconciliation read the mirror had none of (2026-09-14
    // evaluation, h6).
    const { app, queries } = list();
    const res = await app.request(
      'http://localhost/conversations?source=vatplus',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversations: [row],
      isDone: true,
      continueCursor: '',
    });
    const listing = queries.find((text) => text.includes('WITH mirrored AS'));
    expect(listing).toContain('b.owner_user_id = $?');
    expect(listing).toContain(
      'ORDER BY "createdAt" DESC, "conversationId" DESC',
    );
    expect(listing).toContain('LEFT JOIN app.contacts c');
  });

  it('narrows by contactStatus and refuses a value outside the vocabulary', async () => {
    const { app, queries } = list();
    const res = await app.request(
      'http://localhost/conversations?source=vatplus&contactStatus=trashed',
    );
    expect(res.status).toBe(200);
    // The narrowing rides as a nested fragment (recorded on its own by the
    // fake); an unfiltered read binds `TRUE` there instead.
    expect(queries).toContain('"contactStatus" = $?');
    const { app: unfiltered, queries: plain } = list();
    await unfiltered.request('http://localhost/conversations?source=vatplus');
    expect(plain).not.toContain('"contactStatus" = $?');
    const outside = await app.request(
      'http://localhost/conversations?source=vatplus&contactStatus=frozen',
    );
    expect(outside.status).toBe(400);
    expect(await outside.json()).toMatchObject({ code: 'INVALID_QUERY' });
  });

  it('pages with a cursor signed under the source, so another source never redeems it', async () => {
    const older = {
      ...row,
      conversationId: 'c-0',
      createdAt: 1_600_000_000_000,
    };
    const { app } = list([row, older]);
    const first = await app.request(
      'http://localhost/conversations?source=vatplus&limit=1',
    );
    expect(first.status).toBe(200);
    const page: {
      conversations: object[];
      isDone: boolean;
      continueCursor: string;
    } = await first.json();
    expect(page.conversations).toEqual([row]);
    expect(page.isDone).toBe(false);
    expect(page.continueCursor).not.toBe('');
    const same = await app.request(
      `http://localhost/conversations?source=vatplus&limit=1&cursor=${encodeURIComponent(page.continueCursor)}`,
    );
    expect(same.status).toBe(200);
    const other = await app.request(
      `http://localhost/conversations?source=other&limit=1&cursor=${encodeURIComponent(page.continueCursor)}`,
    );
    expect(other.status).toBe(400);
  });
});

describe('GET /conversations/deliveries', () => {
  const row = {
    messageId: 'm-1',
    conversationId: 'c-1',
    externalId: 'x-1',
    status: 'leased',
    attempts: 2,
    availableAt: 1_700_000_000_000,
    retryAt: 1_700_000_300_000,
    claimedAt: 1_700_000_000_500,
    failedAt: null,
    lastErrorCode: 'network_error',
    acknowledgedAt: null,
    receiptId: null,
  };
  const list = (query: string, rows: object[] = [row]) =>
    mount(['org-1'], 'admin', (text) =>
      text.includes('FROM app.conversation_api_bindings') &&
      text.includes('bool_or')
        ? [{ owned: true }]
        : text.includes('FROM app.conversation_api_deliveries d')
          ? rows
          : undefined,
    );

  it('answers the rows with the page envelope and asks the store for the owner’s source only', async () => {
    const { app, queries } = list('source=vatplus');
    const res = await app.request(
      'http://localhost/conversations/deliveries?source=vatplus',
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      deliveries: [row],
      isDone: true,
      continueCursor: '',
    });
    const listing = queries.find((text) =>
      text.includes('FROM app.conversation_api_deliveries d'),
    );
    expect(listing).toContain('b.owner_user_id = $?');
    expect(listing).toContain("THEN 'leased'");
    expect(listing).toContain('ORDER BY retry_key, "messageId"');
    // Neither the claim token nor the body is projected.
    expect(listing).not.toContain('claim_token AS');
    expect(listing).not.toContain('d.body');
  });

  it('mints a cursor bound to the source when a page overflows, and redeems it', async () => {
    const overflow = [row, { ...row, messageId: 'm-2' }];
    const { app } = list('source=vatplus&limit=1', overflow);
    const res = await app.request(
      'http://localhost/conversations/deliveries?source=vatplus&limit=1',
    );
    const body: {
      deliveries: unknown[];
      isDone: boolean;
      continueCursor: string;
    } = await res.json();
    expect(body.deliveries).toHaveLength(1);
    expect(body.isDone).toBe(false);
    expect(body.continueCursor).toBe(
      mintCursorFor(
        'org-1',
        'conversation-deliveries:vatplus',
        '1700000300000:m-1',
      ),
    );
    const next = await app.request(
      `http://localhost/conversations/deliveries?source=vatplus&limit=1&cursor=${encodeURIComponent(body.continueCursor)}`,
    );
    expect(next.status).toBe(200);
    // The same cursor on another source is not one that list answered.
    const foreign = await app.request(
      `http://localhost/conversations/deliveries?source=other&limit=1&cursor=${encodeURIComponent(body.continueCursor)}`,
    );
    expect(foreign.status).toBe(400);
    expect(await foreign.json()).toMatchObject({ code: 'INVALID_CURSOR' });
  });

  it('refuses a state outside the four, a missing source and a blank cursor', async () => {
    const { app } = list('');
    const state = await app.request(
      'http://localhost/conversations/deliveries?source=vatplus&status=lost',
    );
    expect(state.status).toBe(400);
    expect(await state.json()).toMatchObject({
      code: 'INVALID_QUERY',
      error: expect.stringContaining('"status"'),
    });
    const noSource = await app.request(
      'http://localhost/conversations/deliveries',
    );
    expect(noSource.status).toBe(400);
    expect(await noSource.json()).toMatchObject({
      code: 'INVALID_QUERY',
      data: { issues: [expect.objectContaining({ path: 'source' })] },
    });
    const blank = await app.request(
      'http://localhost/conversations/deliveries?source=vatplus&cursor=',
    );
    expect(blank.status).toBe(400);
    expect(await blank.json()).toMatchObject({
      code: 'INVALID_QUERY',
      error: 'invalid query: "cursor" must not be blank',
    });
  });

  it('answers the source refusals a claim answers', async () => {
    const unknown = mount(['org-1'], 'admin', (text) =>
      text.includes('bool_or') ? [{ owned: null }] : undefined,
    );
    const res = await unknown.app.request(
      'http://localhost/conversations/deliveries?source=never',
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({
      code: 'CONVERSATION_SOURCE_NOT_FOUND',
    });
  });
});

/**
 * A dead-lettered delivery can be re-driven from the API (G-03c): a
 * delivery the key user does not own is absent, one that is not
 * dead-lettered is the documented 409.
 */
describe('POST /conversations/deliveries/{id}/retry', () => {
  const retry = (respond: (text: string) => object[] | undefined) =>
    mount(['org-1'], 'admin', respond).app.request(
      'http://localhost/conversations/deliveries/m-1/retry',
      { method: 'POST' },
    );

  it('answers DELIVERY_NOT_FOUND when the key user owns no delivery under the id', async () => {
    const res = await retry(() => undefined);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: 'Delivery not found',
      code: 'DELIVERY_NOT_FOUND',
    });
  });

  it('answers DELIVERY_RETRY_UNAVAILABLE for a delivery that is not dead-lettered', async () => {
    const res = await retry((text) =>
      text.includes('SELECT d.conversation_id AS "conversationId"')
        ? [{ conversationId: 'c-1' }]
        : text.includes("delivery_state = 'failed' FOR UPDATE")
          ? []
          : undefined,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'DELIVERY_RETRY_UNAVAILABLE',
    });
  });

  it('re-queues a dead-lettered delivery of the key user’s own source', async () => {
    const res = await retry((text) =>
      text.includes('SELECT d.conversation_id AS "conversationId"')
        ? [{ conversationId: 'c-1' }]
        : text.includes("delivery_state = 'failed' FOR UPDATE")
          ? [{ id: 'm-1' }]
          : text.includes(
                'UPDATE app.conversation_api_deliveries d SET failed_at_ms = NULL',
              )
            ? [{ conversationId: 'c-1' }]
            : text.includes("SET delivery_state = 'queued'")
              ? [{ id: 'm-1' }]
              : undefined,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});

/**
 * The receipt names the teardown. It carried `version`, the contact and
 * the attachments but not `sourceDeleted`, so an engine resuming from it
 * pushed its next content snapshot onto a torn-down mirror — and the
 * snapshot reopened it (2026-09-15 evaluation, i7).
 */
describe('GET /conversations/sync — the receipt after a teardown', () => {
  it('reports sourceDeleted and the Inbox status beside the contact', async () => {
    const { app, queries } = mount(['org-1'], 'admin', (text) =>
      text.includes('FROM app.conversation_api_bindings WHERE') &&
      text.includes('AND owner_user_id = $?')
        ? [
            {
              conversationId: 'c-1',
              version: 4,
              organizationId: 'org-1',
              externalContactId: 'k1',
              sourceDeleted: true,
            },
          ]
        : text.includes('LEFT JOIN app.contacts c ON c.id = conv.contact_id')
          ? [{ id: 'ct-1', status: null, conversationStatus: 'closed' }]
          : text.includes('FROM app.conversation_api_messages r')
            ? []
            : undefined,
    );
    const res = await app.request(STATE);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      snapshot: {
        conversationId: 'c-1',
        version: 4,
        organizationId: 'org-1',
        externalContactId: 'k1',
        sourceDeleted: true,
        contactId: 'ct-1',
        contactStatus: 'active',
        status: 'closed',
        attachments: [],
      },
    });
    expect(
      queries.find(
        (text) =>
          text.includes('FROM app.conversation_api_bindings WHERE') &&
          text.includes('AND owner_user_id = $?'),
      ),
    ).toContain('source_deleted AS "sourceDeleted"');
  });
});

/**
 * `POST /conversations/assignment` queues a mirrored conversation to a team.
 * Admin and owner keys only (the Inbox's rule); the mirror is named by
 * `source` + `externalId` and must be this key user's; the team must be the
 * organization's.
 */
describe('conversations door — team assignment', () => {
  const ASSIGN = 'http://localhost/conversations/assignment';
  const post = (app: Hono<RestEnv>, body: unknown) =>
    app.request(ASSIGN, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  const BODY = { source: 'vatplus', externalId: 'x1', teamId: 'team-1' };
  const CONVERSATION = {
    id: 'conv-1',
    organizationId: 'org-1',
    subject: 'Invoice',
    status: 'open',
    assigneeUserId: null,
    assigneeTeamId: null,
  };
  const respond =
    (options: { owner?: string; teamOrg?: string; binding?: boolean }) =>
    (text: string): object[] | undefined => {
      if (text.includes('FROM app.conversation_api_bindings')) {
        return options.binding === false
          ? []
          : [
              {
                conversationId: 'conv-1',
                ownerUserId: options.owner ?? 'user-1',
              },
            ];
      }
      if (text.includes('FROM app.conversations')) return [CONVERSATION];
      if (text.includes('FROM "team"')) {
        return [{ organizationId: options.teamOrg ?? 'org-1' }];
      }
      return undefined;
    };

  it('queues the conversation to the team and answers it', async () => {
    const { app, queries } = mount(['org-1'], 'admin', respond({}));
    const res = await post(app, BODY);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      conversationId: 'conv-1',
      assigneeTeamId: 'team-1',
    });
    expect(queries.some((q) => q.includes('SET assignee_team_id'))).toBe(true);
  });

  it('refuses an editor key: assigning is for admins and owners', async () => {
    const { app, queries } = mount(['org-1'], 'editor', respond({}));
    const res = await post(app, BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'ROLE_FORBIDDEN' });
    expect(queries.some((q) => q.includes('SET assignee_team_id'))).toBe(false);
  });

  it('answers 404 CONVERSATION_NOT_FOUND for a mirror no snapshot created', async () => {
    const { app } = mount(['org-1'], 'admin', respond({ binding: false }));
    const res = await post(app, BODY);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'CONVERSATION_NOT_FOUND' });
  });

  it("refuses another service user's mirror", async () => {
    const { app } = mount(['org-1'], 'admin', respond({ owner: 'user-2' }));
    const res = await post(app, BODY);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ code: 'INTEGRATION_NOT_OWNED' });
  });

  it('answers 400 TEAM_NOT_IN_ORG for a team from elsewhere', async () => {
    const { app, queries } = mount(
      ['org-1'],
      'admin',
      respond({ teamOrg: 'org-2' }),
    );
    const res = await post(app, BODY);
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'TEAM_NOT_IN_ORG' });
    expect(queries.some((q) => q.includes('SET assignee_team_id'))).toBe(false);
  });

  it('refuses an unknown key and a missing teamId', async () => {
    const { app } = mount(['org-1'], 'admin', respond({}));
    for (const body of [
      { ...BODY, assigneeUserId: 'u-1' },
      { source: 'vatplus', externalId: 'x1' },
    ]) {
      const res = await post(app, body);
      expect(res.status).toBe(400);
      expect(await res.json()).toMatchObject({ code: 'INVALID_BODY' });
    }
  });
});
