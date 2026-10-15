/**
 * The shipped Outlook connector against a Microsoft Graph fake: which
 * mailbox its calls address, what identity it reports, and what a refusal
 * tells the person who has to fix it. The bodies run the way the dispatcher
 * runs them — the connector's prelude, then the action's own body.
 *
 * A credential that names a `mailbox` (a shared mailbox, reached by the
 * organization's own app or by a person with Full Access to it) addresses
 * `/users/<mailbox>` on every call; one that names none stays on the
 * signed-in account's `/me`, as before.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import {
  connectorLiveBody,
  connectorSchema,
  type Connector,
} from '@tale/shared/schemas/connectors';
import { describe, expect, it } from 'vitest';

import { classifyMailFailure } from '../../backend/core/conversations/mail_sync_failure';
import { parseYamlOrThrow } from '../shared/config/yaml';
import { inProcessLiveRunner } from './in-process-live';

const OUTLOOK_FILE = path.join(
  path.dirname(new URL(import.meta.url).pathname),
  '../../../../configs/platform/system/connectors/outlook/connector.yml',
);

const outlook: Connector = connectorSchema.parse(
  parseYamlOrThrow(readFileSync(OUTLOOK_FILE, 'utf8'), {
    maxBytes: 1024 * 1024,
  }),
);

const SHARED = 'promotion@example.com';
const GRAPH = 'https://graph.microsoft.com/v1.0';

interface Call {
  method: 'GET' | 'POST';
  url: string;
  body?: unknown;
}

interface FakeAnswer {
  status: number;
  body?: unknown;
  headers?: Record<string, string>;
}

/** A Graph fake: every call recorded, each answered by `answer`. */
function graph(answer: (call: Call) => FakeAnswer) {
  const calls: Call[] = [];
  const respond = (call: Call) => {
    calls.push(call);
    const { status, body = {}, headers = {} } = answer(call);
    return {
      status,
      headers,
      json: () => body,
      text: () => JSON.stringify(body),
    };
  };
  return {
    calls,
    http: {
      get: async (url: string) => respond({ method: 'GET', url }),
      post: async (url: string, init?: { body?: string }) =>
        respond({
          method: 'POST',
          url,
          ...(init?.body ? { body: JSON.parse(init.body) } : {}),
        }),
    },
  };
}

async function run(
  actionName: string,
  input: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<unknown> {
  const action = outlook.actions.find((entry) => entry.name === actionName);
  if (action?.backend?.kind !== 'yaml-js') {
    throw new Error(`outlook.${actionName} has no yaml-js live body`);
  }
  return inProcessLiveRunner().runBody(
    connectorLiveBody(outlook, action.backend.live),
    { input, ctx },
    { timeoutMs: 2000 },
    { async: true },
  );
}

async function refusal(
  actionName: string,
  input: Record<string, unknown>,
  ctx: Record<string, unknown>,
): Promise<string> {
  try {
    await run(actionName, input, ctx);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error(`outlook.${actionName} did not refuse`);
}

const INBOX_PAGE = {
  value: [
    {
      id: 'AAMk-1',
      internetMessageId: '<m1@example.net>',
      subject: 'Spring offer',
      from: { emailAddress: { name: 'Mia', address: 'mia@example.net' } },
      toRecipients: [{ emailAddress: { address: SHARED } }],
      receivedDateTime: '2026-10-01T08:00:00Z',
      isRead: false,
      hasAttachments: false,
    },
  ],
  '@odata.nextLink': `${GRAPH}/users/${SHARED}/mailFolders/inbox/messages?$skip=25`,
};

describe('an Outlook credential that names a mailbox acts on that mailbox [CONN-R29]', () => {
  it('lists the named mailbox’s folder, page by page, never /me', async () => {
    const fake = graph(() => ({ status: 200, body: INBOX_PAGE }));

    const out = (await run(
      'list_messages',
      { folder: 'inbox', top: 25, skip: 25 },
      { config: { mailbox: SHARED }, http: fake.http },
    )) as { messages: unknown[]; nextLink: string };

    expect(fake.calls).toHaveLength(1);
    const url = fake.calls[0]?.url ?? '';
    expect(
      url.startsWith(`${GRAPH}/users/${SHARED}/mailFolders/inbox/messages?`),
    ).toBe(true);
    expect(url).toContain('$skip=25');
    expect(url).not.toContain('/me/');
    expect(out.messages).toHaveLength(1);
    // Graph's own link to the next page, which stays on the mailbox.
    expect(out.nextLink).toBe(INBOX_PAGE['@odata.nextLink']);
  });

  it('tells the mailbox’s own mail by the named address, without reading a profile', async () => {
    const fake = graph(() => ({
      status: 200,
      body: {
        value: [
          {
            ...INBOX_PAGE.value[0],
            from: { emailAddress: { address: SHARED } },
          },
          INBOX_PAGE.value[0],
        ],
      },
    }));

    const out = (await run(
      'list_messages',
      { folder: 'inbox', format: 'email' },
      { config: { mailbox: SHARED }, http: fake.http },
    )) as { messages: Array<{ direction: string }> };

    expect(out.messages.map((message) => message.direction)).toEqual([
      'outbound',
      'inbound',
    ]);
    expect(fake.calls).toHaveLength(1);
  });

  it('answers the named mailbox as its identity, with no Graph call', async () => {
    const fake = graph(() => ({ status: 500 }));

    expect(
      await run(
        'get_profile',
        {},
        { config: { mailbox: SHARED }, http: fake.http },
      ),
    ).toEqual({ emailAddress: SHARED });
    expect(fake.calls).toEqual([]);
  });

  it('drafts and sends from the named mailbox', async () => {
    const fake = graph((call) =>
      call.url.endsWith('/send')
        ? { status: 202 }
        : {
            status: 201,
            body: { id: 'draft-1', internetMessageId: '<d1@example.com>' },
          },
    );

    const out = await run(
      'send_message',
      { to: ['mia@example.net'], subject: 'Re: Spring offer', body: 'Hello' },
      { config: { mailbox: SHARED }, http: fake.http },
    );

    expect(fake.calls.map((call) => `${call.method} ${call.url}`)).toEqual([
      `POST ${GRAPH}/users/${SHARED}/messages`,
      `POST ${GRAPH}/users/${SHARED}/messages/draft-1/send`,
    ]);
    expect(out).toMatchObject({ sent: true, messageId: '<d1@example.com>' });
  });

  it('keeps an address’s other characters inside its path segment', async () => {
    const fake = graph(() => ({ status: 200, body: { value: [] } }));

    await run(
      'list_events',
      {},
      { config: { mailbox: 'team+sales/eu@example.com' }, http: fake.http },
    );

    expect(
      fake.calls[0]?.url.startsWith(
        `${GRAPH}/users/team%2Bsales%2Feu@example.com/events?`,
      ),
    ).toBe(true);
  });

  it('stays on the signed-in account’s /me when no mailbox is named', async () => {
    const fake = graph((call) =>
      call.url.startsWith(`${GRAPH}/me?`)
        ? { status: 200, body: { mail: 'ada@example.com' } }
        : { status: 200, body: INBOX_PAGE },
    );

    await run(
      'list_messages',
      { folder: 'inbox' },
      { config: {}, http: fake.http },
    );
    expect(await run('get_profile', {}, { http: fake.http })).toEqual({
      emailAddress: 'ada@example.com',
    });

    expect(fake.calls.map((call) => call.url.split('?')[0])).toEqual([
      `${GRAPH}/me/mailFolders/inbox/messages`,
      `${GRAPH}/me`,
    ]);
  });
});

describe('a refused Outlook call says how the mailbox is granted [CONN-R30]', () => {
  it('names the mailbox and the Exchange application role a 403 lacks', async () => {
    const fake = graph(() => ({
      status: 403,
      body: { error: { code: 'ErrorAccessDenied' } },
    }));

    const message = await refusal(
      'list_messages',
      { folder: 'inbox' },
      { config: { mailbox: SHARED }, http: fake.http },
    );

    expect(message).toContain(`the mailbox ${SHARED}`);
    expect(message).toContain('"Application Mail.Read"');
    expect(message).toContain('management scope');
    expect(message).toContain('RBAC for Applications');
    expect(message).toContain('Full Access');
    // A refusal is no throttle: the sync reports it as a failed pass.
    expect(classifyMailFailure(new Error(message), 'list').kind).toBe('failed');
  });

  it('names the send role, and Send As for a person, when only the send is refused', async () => {
    const fake = graph((call) =>
      call.url.endsWith('/send')
        ? { status: 403 }
        : { status: 201, body: { id: 'draft-1' } },
    );

    const message = await refusal(
      'send_message',
      { to: 'mia@example.net', subject: 'Hi' },
      { config: { mailbox: SHARED }, http: fake.http },
    );

    expect(message).toContain('during send');
    expect(message).toContain('"Application Mail.Send"');
    expect(message).toContain('Send As');
  });

  it('keeps the scope hint for a 403 on the signed-in account’s own mailbox', async () => {
    const fake = graph(() => ({ status: 403 }));

    expect(
      await refusal(
        'create_event',
        {
          subject: 'Review',
          startDateTime: '2026-10-20T09:00:00',
          endDateTime: '2026-10-20T10:00:00',
        },
        { http: fake.http },
      ),
    ).toBe(
      'Outlook create_event failed: permission denied — verify the app has the Calendars.ReadWrite Microsoft Graph scope.',
    );
  });

  it('says the sign-in was refused on a 401', async () => {
    const fake = graph(() => ({ status: 401 }));

    expect(
      await refusal(
        'get_message',
        { messageId: 'AAMk-1' },
        {
          config: { mailbox: SHARED },
          http: fake.http,
        },
      ),
    ).toContain('Microsoft Graph refused the sign-in');
  });

  it('says a named mailbox Graph does not know is not there', async () => {
    const fake = graph(() => ({ status: 404 }));

    expect(
      await refusal(
        'list_messages',
        {},
        {
          config: { mailbox: SHARED },
          http: fake.http,
        },
      ),
    ).toBe(
      `Outlook list_messages failed: Microsoft Graph has no mailbox ${SHARED} — check the address in Settings → Connectors.`,
    );
    expect(
      await refusal(
        'list_messages',
        { folder: 'archive' },
        { config: { mailbox: SHARED }, http: fake.http },
      ),
    ).toBe(
      `Outlook list_messages failed: Microsoft Graph has no mailbox ${SHARED} or no folder "archive" in it — check the address in Settings → Connectors.`,
    );
  });

  it('keeps Graph’s own 404 for what is gone inside the mailbox, never blaming the mailbox', async () => {
    // The message was read, then deleted before its attachments were listed.
    const fake = graph((call) =>
      call.url.endsWith('/attachments')
        ? { status: 404, body: { error: { code: 'ErrorItemNotFound' } } }
        : {
            status: 200,
            body: {
              id: 'AAMk-1',
              subject: 'Spring offer',
              hasAttachments: true,
            },
          },
    );
    const listing = await refusal(
      'get_message',
      { messageId: 'AAMk-1', includeAttachments: true },
      // Never reached: the listing fails before any bytes are stored.
      { config: { mailbox: SHARED }, http: fake.http, files: {} },
    );
    expect(listing).toContain(
      'Outlook get_message failed during attachment listing (404)',
    );
    expect(listing).not.toContain('has no mailbox');
    expect(classifyMailFailure(new Error(listing), 'read').kind).toBe('gone');

    // The draft was created, then removed before it could be sent.
    const send = await refusal(
      'send_message',
      { to: 'mia@example.net', subject: 'Re: Spring offer', body: 'Thanks' },
      {
        config: { mailbox: SHARED },
        http: graph((call) =>
          call.url.endsWith('/send')
            ? { status: 404 }
            : { status: 201, body: { id: 'draft-1' } },
        ).http,
      },
    );
    expect(send).toContain('Outlook send_message failed during send (404)');
    expect(send).not.toContain('has no mailbox');
  });

  it('keeps a message gone since the listing a message, and Graph’s wait a wait', async () => {
    const gone = await refusal(
      'get_message',
      { messageId: 'AAMk-9' },
      {
        config: { mailbox: SHARED },
        http: graph(() => ({ status: 404 })).http,
      },
    );
    expect(gone).toBe('Outlook get_message failed: message AAMk-9 not found.');
    expect(classifyMailFailure(new Error(gone), 'read').kind).toBe('gone');

    const throttled = await refusal(
      'list_messages',
      {},
      {
        config: { mailbox: SHARED },
        http: graph(() => ({ status: 429, headers: { 'retry-after': '30' } }))
          .http,
      },
    );
    expect(throttled).toBe(
      'Outlook list_messages failed: rate limited by Microsoft Graph (retry after 30s) — retry later.',
    );
    expect(classifyMailFailure(new Error(throttled), 'list')).toMatchObject({
      kind: 'rate_limited',
      retryAfterMs: 30_000,
    });
  });
});
