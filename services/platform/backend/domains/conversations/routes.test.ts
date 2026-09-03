/**
 * The Inbox list/counts connector filter WIRE contract. The paginated list
 * adapter serializes `&connectorName=` while the counts adapter serializes
 * `?connector=`; the route must honour whichever key arrives so filtering the
 * Inbox to one mailbox no longer shows every connector's conversations.
 */

import { readFileSync } from 'node:fs';

import type { Context } from 'hono';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { OrgEnv } from '../../auth/org.ts';

/**
 * The role `requireOrgMember` resolves. Hoisted, because the `vi.mock`
 * factory below closes over it and mock factories run before module-body
 * consts initialize. Defaults to admin — every other suite here relies on it.
 */
const viewerRole = vi.hoisted(() => ({ current: 'admin' }));

const {
  listConversationsPage,
  countConversationsByStatus,
  countUnreadConversations,
  projectConversationForView,
  loadMessageForViewer,
  undoSendMessage,
  retrySendMessage,
  discardOutboundMessage,
} = vi.hoisted(() => ({
  listConversationsPage: vi.fn(),
  countConversationsByStatus: vi.fn(),
  countUnreadConversations: vi.fn(),
  projectConversationForView: vi.fn(),
  loadMessageForViewer: vi.fn(),
  undoSendMessage: vi.fn(),
  retrySendMessage: vi.fn(),
  discardOutboundMessage: vi.fn(),
}));

vi.mock('./service.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./service.ts')>();
  return {
    ...actual,
    listConversationsPage,
    countConversationsByStatus,
    countUnreadConversations,
    projectConversationForView,
    loadMessageForViewer,
  };
});

vi.mock('./send.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./send.ts')>();
  return {
    ...actual,
    undoSendMessage,
    retrySendMessage,
    discardOutboundMessage,
  };
});

vi.mock('../../auth/session.ts', () => ({
  requireSession:
    () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
      c.set('sessionBundle', {
        user: { id: 'u1', email: 'u@example.test' },
      } as never);
      await next();
    },
}));

vi.mock('../../auth/org.ts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../auth/org.ts')>();
  return {
    ...actual,
    requireOrgMember:
      () => async (c: Context<OrgEnv>, next: () => Promise<void>) => {
        c.set('orgId', 'o1');
        c.set('orgMember', { role: viewerRole.current } as never);
        await next();
      },
  };
});

import { createConversationRoutes } from './routes.ts';
import { ConversationError, viewerCanWrite } from './service.ts';

function makeApp() {
  return createConversationRoutes({
    sql: {} as never,
    auth: {} as never,
  });
}

describe('conversations route — connector filter wire contract', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    listConversationsPage.mockResolvedValue({
      page: [],
      isDone: true,
      continueCursor: '',
    });
    countConversationsByStatus.mockResolvedValue({});
    countUnreadConversations.mockResolvedValue(0);
    projectConversationForView.mockResolvedValue({});
  });

  it('GET / filters on the client-sent connectorName key', async () => {
    const res = await makeApp().request('/?orgId=o1&connectorName=gmail');
    expect(res.status).toBe(200);
    expect(listConversationsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ connectorName: 'gmail' }),
    );
  });

  it('GET / still accepts the legacy connector key', async () => {
    const res = await makeApp().request('/?orgId=o1&connector=outlook');
    expect(res.status).toBe(200);
    expect(listConversationsPage).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ connectorName: 'outlook' }),
    );
  });

  it('GET / passes no connector filter when neither key is present', async () => {
    await makeApp().request('/?orgId=o1');
    const options = listConversationsPage.mock.calls[0]?.[2] as Record<
      string,
      unknown
    >;
    expect(options).not.toHaveProperty('connectorName');
  });

  it('GET /counts filters on connectorName too', async () => {
    await makeApp().request('/counts?orgId=o1&connectorName=imap-smtp');
    expect(countConversationsByStatus).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'imap-smtp',
    );
    expect(countUnreadConversations).toHaveBeenCalledWith(
      expect.anything(),
      'o1',
      'imap-smtp',
    );
  });
});

/**
 * The message-level doors act on a message only inside a conversation the
 * viewer can open. Org scoping alone let a member holding a messageId cancel,
 * resend, or discard a colleague's outbound mail in a conversation the
 * assignment predicate hides from them; the guard the attachments door
 * already ran now fronts undo, retry and discard too.
 */
describe('conversations route — message doors share the visibility guard', () => {
  const doors = [
    ['undo', undoSendMessage],
    ['retry', retrySendMessage],
    ['discard', discardOutboundMessage],
  ] as const;

  beforeEach(() => {
    vi.clearAllMocks();
    undoSendMessage.mockResolvedValue({ sourceMarkdown: null });
    retrySendMessage.mockResolvedValue(undefined);
    discardOutboundMessage.mockResolvedValue(undefined);
  });

  for (const [door, service] of doors) {
    it(`POST /messages/:id/${door} answers the opaque 404 for a hidden conversation and touches nothing`, async () => {
      loadMessageForViewer.mockRejectedValue(
        new ConversationError(
          'conversation_not_found',
          'Conversation not found',
          404,
        ),
      );
      const res = await makeApp().request(
        '/messages/m1/' + door + '?orgId=o1',
        {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        },
      );
      expect(res.status).toBe(404);
      expect(loadMessageForViewer).toHaveBeenCalledWith(
        expect.anything(),
        { organizationId: 'o1', userId: 'u1', role: 'admin' },
        'm1',
      );
      expect(service).not.toHaveBeenCalled();
    });

    it(`POST /messages/:id/${door} runs for a message the viewer can open`, async () => {
      loadMessageForViewer.mockResolvedValue({
        id: 'm1',
        conversationId: 'c1',
        connectorName: 'imap-smtp',
      });
      const res = await makeApp().request(
        '/messages/m1/' + door + '?orgId=o1',
        {
          method: 'POST',
          body: '{}',
          headers: { 'content-type': 'application/json' },
        },
      );
      expect(res.status).toBe(200);
      expect(service).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ organizationId: 'o1', messageId: 'm1' }),
      );
    });
  }
});

/**
 * Every write-shaped door must check the role, and the check must be the
 * FIRST statement in the handler — before the body parse, so a refusal never
 * depends on the payload. Twelve doors carry it today. The two assignment
 * doors are the deliberate exception: `assignConversation` /
 * `assignConversationTeam` gate on `viewerIsAdmin` in the service, which is
 * stricter than editor, so a route-level editor check there would LOOSEN them.
 *
 * This reads the source rather than driving each handler because the failure
 * it catches is a NEW door shipping ungated — a case no existing test would
 * cover, by definition.
 */
describe('conversations route — every write door checks the role', () => {
  /** Doors whose role gate lives in the service, at a stricter level. */
  const ADMIN_ONLY_IN_SERVICE = new Set(['/:id/assign', '/:id/assign-team']);

  const source = readFileSync(
    new URL('./routes.ts', import.meta.url),
    'utf8',
  ).split('\n');

  const writeRoutes = source.flatMap((line, index) => {
    const match = /^\s*app\.(post|patch|delete)\('([^']*)'/.exec(line);
    return match === null
      ? []
      : [
          {
            door: `${match[1].toUpperCase()} ${match[2]}`,
            path: match[2],
            next: source[index + 1] ?? '',
          },
        ];
  });

  // A pattern that stops matching would make the gate assertion vacuous.
  it('finds the write doors', () => {
    expect(writeRoutes.length).toBe(14);
  });

  it('gates all of them but the admin-only assignment pair', () => {
    const ungated = writeRoutes
      .filter(
        ({ path, next }) =>
          !ADMIN_ONLY_IN_SERVICE.has(path) &&
          !next.includes("viewerCanWrite(c.get('orgMember').role)"),
      )
      .map(({ door }) => door);

    expect(
      ungated,
      `write door(s) with no role check on the handler's first line — a read-only member could reach them:\n  ${ungated.join('\n  ')}`,
    ).toEqual([]);
  });

  it('keeps the assignment pair admin-gated in the service', () => {
    const service = readFileSync(
      new URL('./service.ts', import.meta.url),
      'utf8',
    );
    for (const fn of ['assignConversation', 'assignConversationTeam']) {
      const body = service.slice(
        service.indexOf(`export async function ${fn}`),
      );
      expect(body.slice(0, body.indexOf('\n}')), fn).toContain(
        'viewerIsAdmin(args.actor.role)',
      );
    }
  });
});

/**
 * The write gate, driven through the REAL handlers: a read-only `member` is
 * refused at every write-shaped door and no service function is reached, while
 * an `editor` gets through all of them. The static check above proves the gate
 * is PRESENT on each door; this proves it DECIDES correctly, and that the
 * refusal lands before the handler touches the service.
 */
describe('conversations route — the write gate decides by role', () => {
  /** Every write-shaped door except the admin-only assignment pair. */
  const doors = [
    ['PATCH', '/c1', { status: 'closed' }],
    ['POST', '/c1/read', {}],
    ['POST', '/c1/messages', { content: 'a note' }],
    ['POST', '/c1/reply', { content: 'a reply' }],
    [
      'POST',
      '/compose',
      {
        contactId: 'ct1',
        connectorName: 'imap-smtp',
        subject: 's',
        content: 'c',
      },
    ],
    ['POST', '/bulk/reply', { conversationIds: ['c1'], content: 'b' }],
    ['POST', '/bulk/close', { conversationIds: ['c1'] }],
    ['POST', '/messages/m1/undo', {}],
    ['POST', '/messages/m1/retry', {}],
    ['POST', '/messages/m1/discard', {}],
    ['POST', '/messages/m1/attachments', {}],
    ['DELETE', '/c1', undefined],
  ] as const;

  const call = (method: string, path: string, body: unknown) =>
    makeApp().request(`${path}?orgId=o1`, {
      method,
      ...(body === undefined
        ? {}
        : {
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          }),
    });

  beforeEach(() => {
    vi.clearAllMocks();
    loadMessageForViewer.mockResolvedValue({
      id: 'm1',
      conversationId: 'c1',
      connectorName: 'imap-smtp',
    });
    undoSendMessage.mockResolvedValue({ sourceMarkdown: null });
    retrySendMessage.mockResolvedValue(undefined);
    discardOutboundMessage.mockResolvedValue(undefined);
  });

  afterEach(() => {
    viewerRole.current = 'admin';
  });

  it('covers every gated door', () => {
    expect(doors.length).toBe(12);
  });

  for (const [method, path, body] of doors) {
    it(`refuses a read-only member at ${method} ${path}`, async () => {
      viewerRole.current = 'member';
      const res = await call(method, path, body);

      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ error: 'FORBIDDEN' });
      // Refused before the handler reached anything that could change state.
      expect(loadMessageForViewer).not.toHaveBeenCalled();
      expect(undoSendMessage).not.toHaveBeenCalled();
      expect(retrySendMessage).not.toHaveBeenCalled();
      expect(discardOutboundMessage).not.toHaveBeenCalled();
    });
  }

  // `disabled` is refused by the middleware in production; the gate must also
  // refuse it on its own, so neither layer is the only thing standing there.
  it('refuses a disabled member too', async () => {
    viewerRole.current = 'disabled';
    const res = await call('POST', '/c1/reply', { content: 'a reply' });

    expect(res.status).toBe(403);
  });

  /**
   * The other direction: an editor is never refused BY THE GATE. Only the
   * message-door services are mocked here, so the other doors reach the real
   * service over a stub `sql` and answer 500 — which is itself past the gate,
   * but a bare `!== 403` would accept that 500 even if the gate were broken
   * open in a different way. So check the refusal ENVELOPE, which only the
   * gate produces, and then pin the four doors the mocks carry end to end.
   */
  it('never shows an editor the gate refusal', async () => {
    viewerRole.current = 'editor';
    const bodies = await Promise.all(
      doors.map(async ([method, path, body]) => {
        const res = await call(method, path, body);
        return {
          door: `${method} ${path}`,
          status: res.status,
          body: await res.text(),
        };
      }),
    );

    expect(bodies.filter(({ status }) => status === 403)).toEqual([]);
    expect(
      bodies.filter(({ body }) =>
        body.includes('Only editors and above can change conversations'),
      ),
    ).toEqual([]);
  });

  /** The doors whose services are mocked run all the way through. */
  it('runs an editor through the fully-mocked message doors', async () => {
    viewerRole.current = 'editor';

    for (const door of ['undo', 'retry', 'discard'] as const) {
      const res = await call('POST', `/messages/m1/${door}`, {});
      expect(res.status, door).toBe(200);
    }
    expect(loadMessageForViewer).toHaveBeenCalledTimes(3);

    // The attachment door reaches its own honest answer, not the gate's.
    const attachments = await call('POST', '/messages/m1/attachments', {});
    expect(attachments.status).toBe(501);
    expect(await attachments.json()).toMatchObject({
      error: 'attachment_bytes_unavailable',
    });
  });
});

/**
 * The predicate itself, across the whole role vocabulary. The route suites
 * above drive the boundary role (`editor`) and the two refused ones; this
 * pins the remaining three, so widening `viewerCanWrite` — or a matrix edit
 * that widens it by accident — cannot pass unnoticed.
 */
describe('viewerCanWrite', () => {
  const cases = [
    ['owner', true],
    ['admin', true],
    ['developer', true],
    ['editor', true],
    ['member', false],
    ['disabled', false],
    ['', false],
    ['nonsense', false],
  ] as const;

  for (const [role, allowed] of cases) {
    it(`${allowed ? 'admits' : 'refuses'} ${role === '' ? '<empty>' : role}`, () => {
      expect(viewerCanWrite(role)).toBe(allowed);
    });
  }
});
