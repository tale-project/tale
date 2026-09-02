import { readFileSync } from 'node:fs';

import { afterEach, describe, expect, it, vi } from 'vitest';

import type { NativeConnectorContext } from '../dispatcher';
import {
  discoverSentMailbox,
  fetchSummaries,
  imapSmtpNatives,
  mailboxConfigFromCredential,
  mailAttachmentsFromParsed,
  MAX_ATTACHMENT_BYTES,
  resolveImapFlowConstructor,
  resolveNodemailerCreateTransport,
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
    smtpUsername?: string;
    smtpPassword?: string;
  } = {},
): NativeConnectorContext {
  const secrets: Record<string, string> = {
    username: overrides.username ?? 'mailbox@example.com',
    password: overrides.password ?? PASSWORD,
    ...(overrides.smtpUsername !== undefined && {
      smtpUsername: overrides.smtpUsername,
    }),
    ...(overrides.smtpPassword !== undefined && {
      smtpPassword: overrides.smtpPassword,
    }),
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
  imap: {
    host: 'mail.example.com',
    port: 993,
    secure: true,
    user: 'mailbox@example.com',
    password: PASSWORD,
  },
  smtp: {
    host: 'mail.example.com',
    port: 587,
    secure: false,
    user: 'mailbox@example.com',
    password: PASSWORD,
  },
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
        getMessage(uid) {
          return Promise.resolve({
            uid,
            messageId: `<msg-${uid}@example.com>`,
            from: [{ address: 'sender@example.com' }],
            to: [{ address: 'you@example.com' }],
            cc: [],
            subject: `Subject ${uid}`,
            date: '1970-01-01T00:00:00.000Z',
            text: `Body for ${uid}`,
            flags: [],
            headers: {
              'message-id': `<msg-${uid}@example.com>`,
              'in-reply-to': '<parent@example.com>',
              references: '<parent@example.com>',
            },
          });
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

describe('get_message', () => {
  it('returns body text and threading headers for a UID', async () => {
    const transport = stubTransport();
    const output = await natives(transport)['imap-smtp.get_message'](
      { uid: '99', mailbox: 'INBOX' },
      context(),
    );

    expect(output).toEqual({
      uid: '99',
      email: {
        uid: 99,
        messageId: '<msg-99@example.com>',
        from: [{ address: 'sender@example.com' }],
        to: [{ address: 'you@example.com' }],
        cc: [],
        subject: 'Subject 99',
        date: '1970-01-01T00:00:00.000Z',
        text: 'Body for 99',
        flags: [],
        headers: {
          'message-id': '<msg-99@example.com>',
          'in-reply-to': '<parent@example.com>',
          references: '<parent@example.com>',
        },
      },
    });
    expect(transport.log.imapClosed).toBe(1);
  });

  it('passes attachments through on the email object', async () => {
    const transport = stubTransport();
    transport.openImap = () =>
      Promise.resolve({
        listMessages() {
          return Promise.resolve([]);
        },
        getMessage(uid) {
          return Promise.resolve({
            uid,
            messageId: `<msg-${uid}@example.com>`,
            from: [{ address: 'sender@example.com' }],
            to: [{ address: 'you@example.com' }],
            cc: [],
            subject: `Subject ${uid}`,
            date: '1970-01-01T00:00:00.000Z',
            text: `Body for ${uid}`,
            flags: [],
            headers: { 'message-id': `<msg-${uid}@example.com>` },
            attachments: [
              {
                id: 'cv',
                filename: 'CV.pdf',
                contentType: 'application/pdf',
                size: 4,
                contentBase64: 'JVBE',
              },
            ],
          });
        },
        close() {
          return Promise.resolve();
        },
      });

    const output = await natives(transport)['imap-smtp.get_message'](
      { uid: '3' },
      context(),
    );

    expect(output).toMatchObject({
      uid: '3',
      email: {
        attachments: [
          {
            id: 'cv',
            filename: 'CV.pdf',
            contentType: 'application/pdf',
            size: 4,
            contentBase64: 'JVBE',
          },
        ],
      },
    });
  });

  it('refuses a non-numeric UID', async () => {
    const transport = stubTransport();
    await expect(
      natives(transport)['imap-smtp.get_message']({ uid: 'abc' }, context()),
    ).rejects.toThrow(/not a valid IMAP UID/);
  });
});

describe('mailAttachmentsFromParsed', () => {
  it('caps inline bytes at the size the shipped manifest advertises', () => {
    // `get_message`'s description names this number, and a caller reading the
    // catalogue budgets against it. Bumping the constant without the manifest
    // (or the reverse) makes the contract lie, so they are asserted together.
    const manifest = readFileSync(
      new URL(
        '../../../../../configs/platform/system/connectors/imap-smtp/connector.yml',
        import.meta.url,
      ),
      'utf8',
    );
    const advertised = /base64 content when under (\d+) MiB/.exec(manifest);
    expect(advertised?.[1]).toBeDefined();
    expect(MAX_ATTACHMENT_BYTES).toBe(Number(advertised?.[1]) * 1024 * 1024);
  });

  it('encodes small parts as base64 and keeps oversized metadata-only', () => {
    const small = Buffer.from('hello');
    const large = Buffer.alloc(MAX_ATTACHMENT_BYTES + 1, 1);
    const out = mailAttachmentsFromParsed([
      {
        filename: 'note.txt',
        contentType: 'text/plain',
        size: small.byteLength,
        content: small,
      },
      {
        filename: 'huge.bin',
        contentType: 'application/octet-stream',
        size: large.byteLength,
        content: large,
      },
      {
        filename: 'inline.png',
        contentType: 'image/png',
        contentId: '<cid@x>',
        content: Buffer.from([1, 2, 3]),
      },
    ]);

    expect(out).toEqual([
      {
        id: 'att-1-note.txt',
        filename: 'note.txt',
        contentType: 'text/plain',
        size: 5,
        contentBase64: small.toString('base64'),
      },
      {
        id: 'att-2-huge.bin',
        filename: 'huge.bin',
        contentType: 'application/octet-stream',
        size: large.byteLength,
      },
      {
        id: 'cid@x',
        filename: 'inline.png',
        contentType: 'image/png',
        size: 3,
        contentId: 'cid@x',
        contentBase64: Buffer.from([1, 2, 3]).toString('base64'),
      },
    ]);
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

  it('rewrites From to notification@ when notificationSender is set', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.send'](
      {
        to: 'person@example.com',
        subject: 'Hello',
        text: 'Hi.',
        notificationSender: true,
      },
      context(),
    );

    expect(transport.log.sent[0]?.from).toBe('notification@example.com');
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

  it('carries cc, the References chain, and attachments', async () => {
    const transport = stubTransport();
    await natives(transport)['imap-smtp.send'](
      {
        to: 'person@example.com',
        cc: 'watcher@example.com, boss@example.com',
        subject: 'Re: Hello',
        html: '<p>Hi.</p>',
        inReplyTo: '<parent@example.com>',
        references: ['<root@example.com>', '<parent@example.com>'],
        attachments: [
          {
            name: 'invoice.pdf',
            contentType: 'application/pdf',
            size: 1024,
            url: 'https://blob.example.test/invoice.pdf?sig=abc',
          },
        ],
      },
      context(),
    );

    expect(transport.log.sent[0]).toMatchObject({
      cc: 'watcher@example.com, boss@example.com',
      references: ['<root@example.com>', '<parent@example.com>'],
      attachments: [
        {
          filename: 'invoice.pdf',
          contentType: 'application/pdf',
          url: 'https://blob.example.test/invoice.pdf?sig=abc',
        },
      ],
    });
  });

  it('refuses a line break injected through cc before opening a connection', async () => {
    const transport = stubTransport();
    await expect(
      natives(transport)['imap-smtp.send'](
        {
          to: 'person@example.com',
          cc: 'ok@example.com\nbcc: victim@example.com',
          subject: 'Hi',
        },
        context(),
      ),
    ).rejects.toMatchObject({ code: 'INPUT_INVALID' });
    expect(transport.log.smtpOpened).toBe(0);
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

describe('mail library interop', () => {
  it('accepts the named ImapFlow export Node resolves for the external package', () => {
    class FakeImapFlow {
      readonly options: Record<string, unknown>;
      constructor(options: Record<string, unknown>) {
        this.options = options;
      }
    }
    expect(resolveImapFlowConstructor({ ImapFlow: FakeImapFlow })).toBe(
      FakeImapFlow,
    );
  });

  it('refuses a module whose ImapFlow is not constructable', () => {
    // The failure mode Convex bundling produced: a non-function binding that
    // then threw "t is not a constructor" at `new ImapFlow(...)`.
    expect(() => resolveImapFlowConstructor({ ImapFlow: {} })).toThrow(
      /ImapFlow constructor/,
    );
  });

  it('accepts nodemailer createTransport from the CJS named export', () => {
    const createTransport = () => ({
      sendMail: async () => ({ messageId: '1' }),
      close: () => {},
    });
    expect(resolveNodemailerCreateTransport({ createTransport })).toBe(
      createTransport,
    );
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
      imap: {
        host: 'imap.example.com',
        port: 993,
        secure: true,
        user: 'mailbox@example.com',
        password: PASSWORD,
      },
      smtp: {
        host: 'smtp.example.com',
        port: 465,
        secure: true,
        user: 'mailbox@example.com',
        password: PASSWORD,
      },
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

    expect(config.imap).toMatchObject({
      host: 'mail.example.com',
      port: 143,
      secure: false,
    });
    expect(config.smtp).toMatchObject({
      host: 'mail.example.com',
      port: 587,
      secure: false,
    });
    expect(config.sentMailbox).toBe('INBOX.Sent');
  });

  it('lets well-known ports override a mismatched security setting', () => {
    // The connector declares one `security` for both servers, and the catalog
    // once defaulted smtpPort to 587 while security stayed `tls` — implicit
    // TLS against a STARTTLS greeting is OpenSSL's `wrong version number`.
    const mismatched = mailboxConfigFromCredential(
      context({
        config: {
          imapHost: 'imap.gmail.com',
          smtpHost: 'smtp.gmail.com',
          security: 'tls',
          smtpPort: 587,
        },
      }),
      'send',
    );
    expect(mismatched.imap).toMatchObject({ port: 993, secure: true });
    expect(mismatched.smtp).toMatchObject({ port: 587, secure: false });

    const reverse = mailboxConfigFromCredential(
      context({
        config: {
          imapHost: 'imap.gmail.com',
          smtpHost: 'smtp.gmail.com',
          security: 'starttls',
          imapPort: 993,
          smtpPort: 465,
        },
      }),
      'send',
    );
    expect(reverse.imap).toMatchObject({ port: 993, secure: true });
    expect(reverse.smtp).toMatchObject({ port: 465, secure: true });
  });

  it('honours security only for non-standard ports', () => {
    const config = mailboxConfigFromCredential(
      context({
        config: {
          imapHost: 'mail.example.com',
          smtpHost: 'mail.example.com',
          security: 'starttls',
          imapPort: 10143,
          smtpPort: 10465,
        },
      }),
      'send',
    );
    expect(config.imap.secure).toBe(false);
    expect(config.smtp.secure).toBe(false);
  });

  it('sends through a separate SMTP relay login when one is stored', () => {
    // 0.3's "Use a separate SMTP provider" — IMAP keeps the mailbox login,
    // SMTP authenticates as the relay (Resend's `resend` + API key, …).
    const config = mailboxConfigFromCredential(
      context({
        config: {
          imapHost: 'imap.example.com',
          smtpHost: 'smtp.resend.com',
          smtpPort: 465,
        },
        smtpUsername: 'resend',
        smtpPassword: 're_key',
      }),
      'send',
    );

    expect(config.imap.user).toBe('mailbox@example.com');
    expect(config.imap.password).toBe(PASSWORD);
    expect(config.smtp).toMatchObject({
      host: 'smtp.resend.com',
      port: 465,
      user: 'resend',
      password: 're_key',
    });
  });

  it('refuses a half-configured SMTP relay rather than mixing logins', () => {
    expect(() =>
      mailboxConfigFromCredential(context({ smtpUsername: 'resend' }), 'send'),
    ).toThrowError(expect.objectContaining({ code: 'CREDENTIAL_UNRESOLVED' }));
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

/** A minimal ImapFlow-shaped client for exercising fetchSummaries directly:
 * SEARCH answers UIDs ascending; FETCH yields one envelope per UID (the
 * cursored path passes an explicit UID array). */
function stubImapClient(uidToSentAt: Record<number, number>) {
  const allUids = Object.keys(uidToSentAt)
    .map(Number)
    .sort((a, b) => a - b);
  async function* fetch(range: number[] | string) {
    const wanted = Array.isArray(range) ? range : allUids;
    for (const uid of wanted) {
      const at = uidToSentAt[uid] ?? 0;
      yield {
        uid,
        envelope: { date: new Date(at) },
        internalDate: new Date(at),
      };
    }
  }
  return {
    mailbox: { exists: allUids.length },
    search: () => Promise.resolve(allUids),
    fetch,
  } as unknown as Parameters<typeof fetchSummaries>[0];
}

describe('fetchSummaries drain order', () => {
  it('takes the OLDEST window after a cursor, so a backlog drains forward', async () => {
    const client = stubImapClient({
      1: 1000,
      2: 2000,
      3: 3000,
      4: 4000,
      5: 5000,
    });
    const summaries = await fetchSummaries(client, {
      mailbox: { kind: 'inbox' },
      since: 500,
      limit: 2,
    });
    // The two OLDEST after the cursor — never the newest tail (4, 5), which
    // would strand everything older than it behind the advancing watermark.
    expect(summaries.map((s) => s.uid)).toEqual(['1', '2']);
    expect(summaries.map((s) => s.sentAt)).toEqual([1000, 2000]);
  });
});
