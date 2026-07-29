import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import {
  discoverSentMailbox,
  imapSmtpNatives,
  mailboxConfigFromCredential,
  selectMailbox,
  type ImapSession,
  type MailboxConfig,
  type MailboxQuery,
  type MailTransport,
  type OutboundMail,
  type SmtpSession,
} from './imap-smtp';

/**
 * A mailbox session is a socket and a server-side lock, so the tests that
 * matter most here are the lifecycle ones: the connection is closed when the
 * exchange succeeds, when it fails, and even when closing itself fails — and
 * the credential never appears in what gets logged along the way.
 *
 * No mail server, and no mail library: the transport is injected, so nothing
 * in this file opens a socket.
 */

const PASSWORD = 'hunter2-correct-horse';

function context(
  overrides: {
    config?: Record<string, string | number | boolean>;
    username?: string;
    password?: string;
  } = {},
): NativeConnectorContext {
  const secrets: Record<string, string> = {
    username: overrides.username ?? 'mailbox@example.com',
    password: overrides.password ?? PASSWORD,
  };
  return {
    secrets: { get: (name: string) => secrets[name] ?? '' },
    idempotencyKey: 'key_1',
    organizationId: 'org_1',
    credentialId: 'cred_1',
    authMethod: 'basic',
    config: overrides.config ?? {
      imapHost: 'mail.example.com',
      smtpHost: 'mail.example.com',
    },
    http: {
      get: () => Promise.reject(new Error('no HTTP in a mail native')),
      post: () => Promise.reject(new Error('no HTTP in a mail native')),
      put: () => Promise.reject(new Error('no HTTP in a mail native')),
      patch: () => Promise.reject(new Error('no HTTP in a mail native')),
      delete: () => Promise.reject(new Error('no HTTP in a mail native')),
    },
    base64Encode: (value) => Buffer.from(value, 'utf8').toString('base64'),
    base64Decode: (value) => Buffer.from(value, 'base64').toString('utf8'),
  };
}

const CONFIG: MailboxConfig = {
  imap: { host: 'mail.example.com', port: 993, secure: true },
  smtp: { host: 'mail.example.com', port: 587, secure: false },
  user: 'mailbox@example.com',
  password: PASSWORD,
  from: 'mailbox@example.com',
  connectTimeoutMs: 1000,
  socketTimeoutMs: 2000,
};

interface TransportLog {
  imapOpened: number;
  imapClosed: number;
  smtpOpened: number;
  smtpClosed: number;
  queries: MailboxQuery[];
  sent: OutboundMail[];
}

interface TransportOptions {
  listThrows?: Error;
  sendThrows?: Error;
  closeThrows?: Error;
  messageId?: string;
  messages?: Array<{
    uid: string;
    from: string;
    subject: string;
    sentAt: number;
  }>;
}

function stubTransport(options: TransportOptions = {}): MailTransport & {
  log: TransportLog;
} {
  const log: TransportLog = {
    imapOpened: 0,
    imapClosed: 0,
    smtpOpened: 0,
    smtpClosed: 0,
    queries: [],
    sent: [],
  };
  return {
    log,
    openImap(): Promise<ImapSession> {
      log.imapOpened++;
      return Promise.resolve({
        listMessages(query) {
          log.queries.push(query);
          if (options.listThrows) return Promise.reject(options.listThrows);
          return Promise.resolve(
            options.messages ?? [
              {
                uid: '17',
                from: 'sender@example.com',
                subject: 'Quarterly numbers',
                sentAt: 1_700_000_000_000,
              },
            ],
          );
        },
        close() {
          log.imapClosed++;
          if (options.closeThrows) return Promise.reject(options.closeThrows);
          return Promise.resolve();
        },
      });
    },
    openSmtp(): Promise<SmtpSession> {
      log.smtpOpened++;
      return Promise.resolve({
        send(message) {
          log.sent.push(message);
          if (options.sendThrows) return Promise.reject(options.sendThrows);
          return Promise.resolve({
            messageId: options.messageId ?? '<sent-1@example.com>',
          });
        },
        close() {
          log.smtpClosed++;
          if (options.closeThrows) return Promise.reject(options.closeThrows);
          return Promise.resolve();
        },
      });
    },
  };
}

function natives(transport: MailTransport) {
  return imapSmtpNatives({ transport, resolveConfig: () => CONFIG });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('list_messages', () => {
  it('returns the message summaries the connector declares', async () => {
    const transport = stubTransport();
    const output = await natives(transport)['imap-smtp.list_messages'](
      { mailbox: 'INBOX', limit: 25 },
      context(),
    );

    expect(output).toEqual({
      messages: [
        {
          uid: '17',
          from: 'sender@example.com',
          subject: 'Quarterly numbers',
          sentAt: 1_700_000_000_000,
        },
      ],
    });
  });

  it('reads the inbox by default, and the Sent folder on request', async () => {
    const transport = stubTransport();
    const impls = natives(transport);
    await impls['imap-smtp.list_messages']({}, context());
    await impls['imap-smtp.list_messages']({ mailbox: 'sent' }, context());
    await impls['imap-smtp.list_messages']({ mailbox: 'Archive' }, context());

    expect(transport.log.queries.map((query) => query.mailbox)).toEqual([
      { kind: 'inbox' },
      { kind: 'sent' },
      { kind: 'named', path: 'Archive' },
    ]);
  });

  it('defaults the window to 25 and bounds what a caller asks for', async () => {
    const transport = stubTransport();
    const impls = natives(transport);
    await impls['imap-smtp.list_messages']({}, context());
    await impls['imap-smtp.list_messages']({ limit: 5000 }, context());
    await impls['imap-smtp.list_messages']({ limit: 0 }, context());

    expect(transport.log.queries.map((query) => query.limit)).toEqual([
      25, 100, 1,
    ]);
  });

  it('carries the cursor, and ignores one that is not an instant', async () => {
    const transport = stubTransport();
    const impls = natives(transport);
    await impls['imap-smtp.list_messages'](
      { since: 1_699_000_000_000 },
      context(),
    );
    await impls['imap-smtp.list_messages']({ since: 0 }, context());

    expect(transport.log.queries.map((query) => query.since)).toEqual([
      1_699_000_000_000,
      undefined,
    ]);
  });

  it('closes the connection when the fetch succeeds', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.list_messages']({}, context());

    expect(transport.log).toMatchObject({ imapOpened: 1, imapClosed: 1 });
  });

  it('closes the connection when the fetch fails, and reports the failure', async () => {
    const transport = stubTransport({
      listThrows: new Error('mailbox does not exist'),
    });

    await expect(
      natives(transport)['imap-smtp.list_messages']({}, context()),
    ).rejects.toThrow('mailbox does not exist');
    expect(transport.log).toMatchObject({ imapOpened: 1, imapClosed: 1 });
  });

  it('does not let a failed close replace the result, and logs no secrets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const transport = stubTransport({
      closeThrows: new Error('logout timed out'),
    });

    await expect(
      natives(transport)['imap-smtp.list_messages']({}, context()),
    ).resolves.toMatchObject({ messages: expect.any(Array) });

    expect(warn).toHaveBeenCalledTimes(1);
    const logged = warn.mock.calls.flat().join(' ');
    expect(logged).toContain('logout timed out');
    expect(logged).not.toContain(PASSWORD);
    expect(logged).not.toContain('mailbox@example.com');
  });
});

describe('send', () => {
  it('returns the message id the server assigned', async () => {
    const transport = stubTransport({ messageId: '<abc@example.com>' });
    const output = await natives(transport)['imap-smtp.send'](
      { to: 'person@example.com', subject: 'Hello', text: 'Hi there.' },
      context(),
    );

    expect(output).toEqual({ messageId: '<abc@example.com>' });
  });

  it('sends from the mailbox the credential names', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.send'](
      { to: 'person@example.com', subject: 'Hello', text: 'Hi.' },
      context(),
    );

    expect(transport.log.sent[0]).toEqual({
      from: 'mailbox@example.com',
      to: 'person@example.com',
      subject: 'Hello',
      text: 'Hi.',
    });
  });

  it('carries threading headers when the caller replies to a message', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.send'](
      {
        to: 'person@example.com',
        subject: 'Re: Hello',
        html: '<p>Hi.</p>',
        inReplyTo: '<parent@example.com>',
      },
      context(),
    );

    expect(transport.log.sent[0]).toMatchObject({
      html: '<p>Hi.</p>',
      inReplyTo: '<parent@example.com>',
    });
  });

  it('closes the connection when the send succeeds', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.send'](
      { to: 'person@example.com', subject: 'Hello' },
      context(),
    );

    expect(transport.log).toMatchObject({ smtpOpened: 1, smtpClosed: 1 });
  });

  it('closes the connection when the send fails', async () => {
    const transport = stubTransport({
      sendThrows: new Error('550 mailbox unavailable'),
    });

    await expect(
      natives(transport)['imap-smtp.send'](
        { to: 'person@example.com', subject: 'Hello' },
        context(),
      ),
    ).rejects.toThrow('550 mailbox unavailable');
    expect(transport.log).toMatchObject({ smtpOpened: 1, smtpClosed: 1 });
  });

  it('refuses a line break in a header before opening a connection', async () => {
    for (const input of [
      { to: 'person@example.com\nbcc: victim@example.com', subject: 'Hi' },
      { to: 'person@example.com', subject: 'Hi\r\nbcc: victim@example.com' },
      {
        to: 'person@example.com',
        subject: 'Hi',
        inReplyTo: '<x>\nbcc: victim@example.com',
      },
    ]) {
      const transport = stubTransport();
      await expect(
        natives(transport)['imap-smtp.send'](input, context()),
      ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
      expect(transport.log.smtpOpened).toBe(0);
    }
  });

  it('refuses a recipient that is not an address', async () => {
    const transport = stubTransport();
    await expect(
      natives(transport)['imap-smtp.send'](
        { to: 'the sales team', subject: 'Hi' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(transport.log.smtpOpened).toBe(0);
  });

  it('refuses to report a send the server did not identify', async () => {
    const transport = stubTransport({ messageId: '   ' });
    await expect(
      natives(transport)['imap-smtp.send'](
        { to: 'person@example.com', subject: 'Hello' },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'LIVE_BODY_FAILED' });
    expect(transport.log.smtpClosed).toBe(1);
  });
});

describe('mailbox configuration', () => {
  it('reads the login and the servers from the credential config, defaulting to implicit TLS', () => {
    const config = mailboxConfigFromCredential(
      context({
        config: { imapHost: 'imap.example.com', smtpHost: 'smtp.example.com' },
      }),
      'send',
    );

    expect(config).toMatchObject({
      imap: { host: 'imap.example.com', port: 993, secure: true },
      smtp: { host: 'smtp.example.com', port: 465, secure: true },
      user: 'mailbox@example.com',
      from: 'mailbox@example.com',
    });
  });

  it('honours starttls and explicit ports', () => {
    const config = mailboxConfigFromCredential(
      context({
        config: {
          imapHost: 'mail.example.com',
          smtpHost: 'mail.example.com',
          security: 'starttls',
          imapPort: 143,
          smtpPort: 587,
          sentMailbox: 'INBOX.Sent',
        },
      }),
      'list_messages',
    );

    expect(config.imap).toEqual({
      host: 'mail.example.com',
      port: 143,
      secure: false,
    });
    expect(config.smtp).toEqual({
      host: 'mail.example.com',
      port: 587,
      secure: false,
    });
    expect(config.sentMailbox).toBe('INBOX.Sent');
  });

  it('derives a sender for a login that is a bare account name', () => {
    const config = mailboxConfigFromCredential(
      context({
        config: { imapHost: 'mail.example.com', smtpHost: 'mail.example.com' },
        username: 'postmaster',
      }),
      'send',
    );

    expect(config.from).toBe('postmaster@mail.example.com');
  });

  it('refuses a credential with no login', () => {
    expect(() =>
      mailboxConfigFromCredential(context({ password: '' }), 'send'),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_UNRESOLVED' }));
  });

  it('refuses a credential that names no server rather than guessing one', () => {
    expect(() =>
      mailboxConfigFromCredential(context({ config: {} }), 'send'),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_UNRESOLVED' }));
  });
});

describe('mailbox selection', () => {
  it('maps what a caller writes onto the folder it means', () => {
    expect(selectMailbox(undefined)).toEqual({ kind: 'inbox' });
    expect(selectMailbox('')).toEqual({ kind: 'inbox' });
    expect(selectMailbox('INBOX')).toEqual({ kind: 'inbox' });
    expect(selectMailbox('Sent')).toEqual({ kind: 'sent' });
    expect(selectMailbox(' sent ')).toEqual({ kind: 'sent' });
    expect(selectMailbox('Archive/2026')).toEqual({
      kind: 'named',
      path: 'Archive/2026',
    });
  });

  it('prefers the server’s own Sent flag over any name', () => {
    const path = discoverSentMailbox([
      { path: 'Sent', flags: new Set() },
      { path: 'INBOX.Gesendet', flags: new Set(), specialUse: '\\Sent' },
    ]);

    expect(path).toBe('INBOX.Gesendet');
  });

  it('falls back to the operator’s name, then to the common ones', () => {
    expect(
      discoverSentMailbox(
        [
          { path: 'Sent', flags: new Set() },
          { path: 'Gesendet', flags: new Set() },
        ],
        'Gesendet',
      ),
    ).toBe('Gesendet');

    expect(
      discoverSentMailbox([
        { path: 'Drafts', flags: new Set() },
        { path: 'Sent Items', flags: new Set() },
      ]),
    ).toBe('Sent Items');
  });

  it('skips a folder the server says cannot be opened', () => {
    expect(
      discoverSentMailbox([
        { path: 'Sent', flags: new Set(['\\Noselect']) },
        { path: 'INBOX/Sent', flags: new Set() },
      ]),
    ).toBe('INBOX/Sent');
  });

  it('reports no Sent folder rather than picking the wrong one', () => {
    expect(
      discoverSentMailbox([{ path: 'Drafts', flags: new Set() }]),
    ).toBeNull();
  });
});
