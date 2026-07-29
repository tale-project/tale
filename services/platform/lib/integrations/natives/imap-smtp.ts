/**
 * The `imap-smtp` connector's native backends — read a mailbox over IMAP, send
 * a message over SMTP.
 *
 * Both protocols are raw TCP with their own session lifecycle, which is why
 * these actions are native at all: the connector sandbox speaks HTTP and
 * nothing else. That lifecycle is the whole risk surface here, so the rules are
 * explicit and hold on every path:
 *
 *  - **the connection is always closed** — every session is opened outside a
 *    `try` and released in its `finally`, so a failed fetch or a rejected send
 *    cannot leak a socket (and, on IMAP, a server-side mailbox lock) into the
 *    next invocation.
 *  - **there is always a deadline** — connect, greeting, and socket timeouts
 *    are set on both transports, because an unreachable mail server otherwise
 *    hangs the whole invocation until the platform's own ceiling fires.
 *  - **nothing sensitive is logged** — the login, the password, recipients, and
 *    message bodies never reach a log line; failures are reported by what went
 *    wrong, not by what was being sent.
 *  - **TLS is not optional** — a submission port that will not upgrade to TLS
 *    fails the send rather than putting the credential on the wire in the
 *    clear.
 *
 * The transports themselves are injected ({@link MailTransport}) so the rules
 * above are testable without a mail server, and so the IMAP/SMTP client
 * libraries load only where they are actually used.
 */

import { z } from 'zod/v4';

import type {
  NativeIntegrationContext,
  NativeIntegrationImpl,
} from '../dispatcher';
import { IntegrationError, type IntegrationErrorCode } from '../errors';

const CONNECTOR = 'imap-smtp';

/** Messages returned by one `list_messages` when the caller names no limit. */
const DEFAULT_LIMIT = 25;

/** Ceiling for one pass — a sync reads a window and advances its cursor, so an
 * unbounded limit would only trade progress for a timeout. */
const MAX_LIMIT = 100;

/** Standard IMAPS port: implicit TLS from the first byte. */
const IMAPS_PORT = 993;

/** Standard submission port: cleartext handshake upgraded by STARTTLS. */
const SUBMISSION_PORT = 587;

/** Implicit-TLS submission port: TLS from the first byte. */
const SMTPS_PORT = 465;

/** How long a connection attempt may take before the action gives up. */
const CONNECT_TIMEOUT_MS = 15_000;

/** How long a session may stall mid-conversation before it is torn down. */
const SOCKET_TIMEOUT_MS = 30_000;

// ------------------------------------------------------------------ contracts

export interface MailServer {
  readonly host: string;
  readonly port: number;
  /** `true` → TLS from the first byte (993, 465). `false` → STARTTLS. */
  readonly secure: boolean;
}

/** Everything one invocation needs to reach the organization's mailbox. */
export interface MailboxConfig {
  readonly imap: MailServer;
  readonly smtp: MailServer;
  readonly user: string;
  readonly password: string;
  /** Envelope sender for outbound mail. */
  readonly from: string;
  /** The Sent folder's IMAP path, when the operator pinned one; otherwise the
   * transport discovers it. */
  readonly sentMailbox?: string;
  readonly connectTimeoutMs: number;
  readonly socketTimeoutMs: number;
}

/** Which folder `list_messages` reads. */
export type MailboxSelector =
  | { readonly kind: 'inbox' }
  | { readonly kind: 'sent' }
  | { readonly kind: 'named'; readonly path: string };

/** One message, reduced to what the connector declares it returns. */
export interface MailMessageSummary {
  readonly uid: string;
  readonly from: string;
  readonly subject: string;
  /** Epoch ms the message was sent. */
  readonly sentAt: number;
}

export interface MailboxQuery {
  readonly mailbox: MailboxSelector;
  /** Epoch-ms cursor; messages at or after it are returned. */
  readonly since?: number;
  readonly limit: number;
}

export interface ImapSession {
  listMessages(query: MailboxQuery): Promise<readonly MailMessageSummary[]>;
  /** Release the session. Called from a `finally`, so it must not throw. */
  close(): Promise<void>;
}

export interface OutboundMail {
  readonly from: string;
  readonly to: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  /** Message-ID this replies to; the transport also carries it in
   * `References` so a client threads the reply. */
  readonly inReplyTo?: string;
}

export interface SmtpSession {
  send(message: OutboundMail): Promise<{ messageId: string }>;
  /** Release the session. Called from a `finally`, so it must not throw. */
  close(): Promise<void>;
}

/**
 * How the two sessions are opened. Injected so the actions can be exercised
 * without a mail server; a transport that fails to connect owns cleaning up
 * whatever it half-opened, because there is no session for the caller to close.
 */
export interface MailTransport {
  openImap(config: MailboxConfig): Promise<ImapSession>;
  openSmtp(config: MailboxConfig): Promise<SmtpSession>;
}

/**
 * Where the mailbox's connection details come from. Injected so a deployment
 * that keeps them somewhere else can say so; the default reads them from the
 * credential (see {@link mailboxConfigFromCredential}).
 */
export type MailboxConfigResolver = (
  ctx: NativeIntegrationContext,
) => Promise<MailboxConfig> | MailboxConfig;

export interface MailNativeDeps {
  readonly transport: MailTransport;
  readonly resolveConfig?: MailboxConfigResolver;
}

// -------------------------------------------------------------------- helpers

function refuse(
  code: IntegrationErrorCode,
  action: string,
  message: string,
  hint?: string,
): IntegrationError {
  return new IntegrationError(code, message, {
    connector: CONNECTOR,
    action,
    ...(hint !== undefined && { hint }),
  });
}

/**
 * The mailbox's connection details, read from the credential the invocation
 * resolved: the login is its `username`/`password`, and the server is its
 * endpoint origin. Standard ports are assumed — IMAPS 993 for reading and the
 * submission port 587 for sending — with an explicit port on the endpoint
 * taken as the IMAP one; a second spelling of the same thing would only be a
 * second thing to get wrong.
 *
 * A credential that names no server is refused rather than guessed at: there
 * is no safe default host for someone else's mail, and inventing one would
 * either fail obscurely or send the login somewhere nobody chose. A deployment
 * that keeps mailbox servers elsewhere injects its own resolver.
 */
export function mailboxConfigFromCredential(
  ctx: NativeIntegrationContext,
  action: string,
): MailboxConfig {
  const user = ctx.secrets.get('username').trim();
  const password = ctx.secrets.get('password');
  if (user === '' || password === '') {
    throw refuse(
      'CREDENTIAL_UNRESOLVED',
      action,
      'the mailbox credential carries no username and password',
      'reconnect the IMAP / SMTP mailbox in Settings → Integrations',
    );
  }

  // The mail servers travel with the credential as non-secret config fields
  // (the connector declares them), never as a secret and never guessed: there
  // is no safe default host for someone else's mail.
  const imapHost = configString(ctx, 'imapHost');
  const smtpHost = configString(ctx, 'smtpHost');
  if (imapHost === '' || smtpHost === '') {
    throw refuse(
      'CREDENTIAL_UNRESOLVED',
      action,
      'this mailbox credential names no IMAP / SMTP server',
      'set the IMAP and SMTP servers on the credential in Settings → Integrations',
    );
  }

  // `tls` means TLS from the first byte (implicit); `starttls` upgrades a
  // plaintext connection, which the transport then REQUIRES — see
  // `nodeMailTransport`. Defaults match the connector's declared defaults.
  const secure = configString(ctx, 'security', 'tls') !== 'starttls';
  const imapPort = configPort(ctx, 'imapPort', IMAPS_PORT);
  const smtpPort = configPort(
    ctx,
    'smtpPort',
    secure ? SMTPS_PORT : SUBMISSION_PORT,
  );
  const pinnedSent = configString(ctx, 'sentMailbox');

  return {
    imap: { host: imapHost, port: imapPort, secure },
    smtp: { host: smtpHost, port: smtpPort, secure },
    user,
    password,
    // A mailbox login is normally the address itself; when it is a bare
    // account name the server's own domain is the only sender it can be.
    from: user.includes('@') ? user : `${user}@${imapHost}`,
    ...(pinnedSent !== '' && { sentMailbox: pinnedSent }),
    connectTimeoutMs: CONNECT_TIMEOUT_MS,
    socketTimeoutMs: SOCKET_TIMEOUT_MS,
  };
}

/** Read a config field as a trimmed string, falling back to `fallback`. */
function configString(
  ctx: NativeIntegrationContext,
  key: string,
  fallback = '',
): string {
  const value = ctx.config[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Read a config field as a port number, falling back to `fallback` when it is
 * absent or not a usable port. */
function configPort(
  ctx: NativeIntegrationContext,
  key: string,
  fallback: number,
): number {
  const value = ctx.config[key];
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

/** Which folder the caller asked for. `sent` is a role, not a path: servers
 * spell the Sent folder differently, so the transport resolves it. */
export function selectMailbox(mailbox: string | undefined): MailboxSelector {
  const named = mailbox?.trim() ?? '';
  if (named === '') return { kind: 'inbox' };
  if (named.toLowerCase() === 'sent') return { kind: 'sent' };
  if (named.toLowerCase() === 'inbox') return { kind: 'inbox' };
  return { kind: 'named', path: named };
}

/** Sent-folder names servers use when they advertise no `\Sent` special-use
 * flag, most specific first. */
const COMMON_SENT_MAILBOXES = [
  'Sent',
  'Sent Items',
  'Sent Messages',
  'Sent Mail',
  '[Gmail]/Sent Mail',
  'INBOX.Sent',
  'INBOX/Sent',
] as const;

export interface ListedMailbox {
  readonly path: string;
  readonly flags: ReadonlySet<string>;
  readonly specialUse?: string;
}

/**
 * Locate the Sent folder among the server's mailboxes. The `\Sent` special-use
 * flag is authoritative where a server publishes it; otherwise an operator's
 * pinned name wins, then the names providers conventionally use. Returns null
 * when nothing matches, so the caller reports a missing folder instead of
 * reading the wrong one.
 */
export function discoverSentMailbox(
  mailboxes: readonly ListedMailbox[],
  preferred?: string,
): string | null {
  const selectable = mailboxes.filter((box) => !box.flags.has('\\Noselect'));
  const bySpecialUse = selectable.find((box) => box.specialUse === '\\Sent');
  if (bySpecialUse) return bySpecialUse.path;

  const paths = selectable.map((box) => box.path);
  const candidates = [
    ...(preferred?.trim() ? [preferred.trim()] : []),
    ...COMMON_SENT_MAILBOXES,
  ];
  for (const candidate of candidates) {
    const exact = paths.find((path) => path === candidate);
    if (exact) return exact;
    const insensitive = paths.find(
      (path) => path.toLowerCase() === candidate.toLowerCase(),
    );
    if (insensitive) return insensitive;
  }
  return null;
}

/**
 * Run one exchange against a session and release it however the exchange ends.
 * The release lives in a `finally` because the failure paths are exactly the
 * ones that would otherwise leak the socket — and a failure to close is logged
 * (never the credential, the recipients, or the body) rather than thrown, so
 * cleanup can never replace the outcome the caller is waiting for.
 */
async function withSession<S extends { close(): Promise<void> }, R>(
  session: S,
  label: string,
  exchange: (session: S) => Promise<R>,
): Promise<R> {
  try {
    return await exchange(session);
  } finally {
    try {
      await session.close();
    } catch (error) {
      console.warn(
        `[integrations] imap-smtp: closing the ${label} connection failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * A mail header must be a single line. A caller-supplied line break would end
 * the header and let whatever follows be read as one of its own — the reason
 * subjects, recipients, and threading ids are checked before they are handed
 * to a transport.
 */
function assertSingleLine(value: string, field: string, action: string): void {
  if (/[\r\n]/.test(value)) {
    throw refuse(
      'INPUT_INVALID',
      action,
      `${field} must not contain a line break`,
      'a line break would end the mail header and let the rest be read as additional headers',
    );
  }
}

// --------------------------------------------------------------- input shapes

/**
 * The actions re-check their own input. The dispatcher validates it against the
 * connector's JSON Schema first; a native that sends mail on the organization's
 * behalf states its own preconditions rather than inheriting whichever caller
 * happened to reach it.
 */
const listInput = z.object({
  since: z.number().optional(),
  limit: z.number().optional(),
  mailbox: z.string().optional(),
});

const sendInput = z.object({
  to: z.string().min(1),
  subject: z.string(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
});

function parseInput<T>(
  schema: z.ZodType<T>,
  input: unknown,
  action: string,
): T {
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw refuse(
      'INPUT_INVALID',
      action,
      `imap-smtp.${action} input is not usable: ${parsed.error.issues[0]?.message ?? 'invalid input'}`,
    );
  }
  return parsed.data;
}

/** The window one pass reads: a positive whole number, capped. */
function boundedLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return DEFAULT_LIMIT;
  return Math.min(Math.max(1, Math.floor(limit)), MAX_LIMIT);
}

/** The cursor, ignored unless it is a usable epoch-ms instant. */
function boundedSince(since: number | undefined): number | undefined {
  if (since === undefined || !Number.isFinite(since) || since <= 0) {
    return undefined;
  }
  return Math.floor(since);
}

// -------------------------------------------------------------------- actions

/**
 * The two `imap-smtp` native backends, keyed by the impl id their connector
 * declares.
 */
export function imapSmtpNatives(
  deps: MailNativeDeps,
): Readonly<Record<string, NativeIntegrationImpl>> {
  const configFor = async (
    ctx: NativeIntegrationContext,
    action: string,
  ): Promise<MailboxConfig> =>
    deps.resolveConfig
      ? await deps.resolveConfig(ctx)
      : mailboxConfigFromCredential(ctx, action);

  const listMessages: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = parseInput(listInput, input, 'list_messages');
    const since = boundedSince(parsed.since);
    const query: MailboxQuery = {
      mailbox: selectMailbox(parsed.mailbox),
      ...(since !== undefined && { since }),
      limit: boundedLimit(parsed.limit),
    };
    const config = await configFor(ctx, 'list_messages');

    // Opened outside `withSession` so a failed connect — which leaves nothing
    // to release — never reaches a close on a session that does not exist.
    const session = await deps.transport.openImap(config);
    const messages = await withSession(session, 'IMAP', (imap) =>
      imap.listMessages(query),
    );
    return {
      messages: messages.map((message) => ({
        uid: message.uid,
        from: message.from,
        subject: message.subject,
        sentAt: message.sentAt,
      })),
    };
  };

  const send: NativeIntegrationImpl = async (
    input: unknown,
    ctx: NativeIntegrationContext,
  ) => {
    const parsed = parseInput(sendInput, input, 'send');
    const to = parsed.to.trim();
    assertSingleLine(to, 'to', 'send');
    assertSingleLine(parsed.subject, 'subject', 'send');
    if (parsed.inReplyTo !== undefined) {
      assertSingleLine(parsed.inReplyTo, 'inReplyTo', 'send');
    }
    if (!to.includes('@')) {
      throw refuse(
        'INPUT_INVALID',
        'send',
        `"${to.slice(0, 120)}" is not an email address`,
        'pass one recipient address, e.g. person@example.com',
      );
    }

    const config = await configFor(ctx, 'send');
    // A message with no body at all still needs one part or the server has
    // nothing to deliver, so a text-less plain send carries an empty body; a
    // caller that sent HTML alone keeps exactly that.
    const text = parsed.text ?? (parsed.html === undefined ? '' : undefined);
    const message: OutboundMail = {
      from: config.from,
      to,
      subject: parsed.subject,
      ...(text !== undefined && { text }),
      ...(parsed.html !== undefined && { html: parsed.html }),
      ...(parsed.inReplyTo !== undefined && { inReplyTo: parsed.inReplyTo }),
    };

    const session = await deps.transport.openSmtp(config);
    const { messageId } = await withSession(session, 'SMTP', (smtp) =>
      smtp.send(message),
    );
    if (typeof messageId !== 'string' || messageId.trim() === '') {
      // The action's contract is the id of the message that was sent; without
      // one the caller cannot thread or reconcile it, and inventing one would
      // report a delivery nobody can trace.
      throw refuse(
        'LIVE_BODY_FAILED',
        'send',
        'the SMTP server accepted the message but returned no Message-ID',
      );
    }
    return { messageId };
  };

  return {
    'imap-smtp.list_messages': listMessages,
    'imap-smtp.send': send,
  };
}

// -------------------------------------------------------------- the transport

/**
 * The real transport: IMAP through `imapflow`, SMTP through `nodemailer`.
 *
 * Both clients are loaded on first use so a deployment that never opens a
 * mailbox never pays for them, and so the unit tests around the actions above
 * run with no mail libraries loaded at all.
 */
export function nodeMailTransport(): MailTransport {
  return {
    async openImap(config: MailboxConfig): Promise<ImapSession> {
      const { ImapFlow } = await import('imapflow');
      const client = new ImapFlow({
        host: config.imap.host,
        port: config.imap.port,
        secure: config.imap.secure,
        auth: { user: config.user, pass: config.password },
        // The client's own logging would echo the session, including the
        // login exchange, into the platform's logs.
        logger: false,
        connectionTimeout: config.connectTimeoutMs,
        greetingTimeout: config.connectTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
      });

      try {
        await client.connect();
      } catch (error) {
        // Nothing to hand back, so the half-open socket is this function's to
        // drop — `close()` is synchronous and safe on a failed connect.
        client.close();
        throw error;
      }

      return {
        async listMessages(
          query: MailboxQuery,
        ): Promise<readonly MailMessageSummary[]> {
          const path = await resolveMailboxPath(
            client,
            query.mailbox,
            config.sentMailbox,
          );
          const lock = await client.getMailboxLock(path);
          try {
            return await fetchSummaries(client, query);
          } finally {
            lock.release();
          }
        },
        async close(): Promise<void> {
          await client.logout();
        },
      };
    },

    async openSmtp(config: MailboxConfig): Promise<SmtpSession> {
      const nodemailer = await import('nodemailer');
      const transport = nodemailer.createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        // Fail closed on the STARTTLS path: without this, a server that omits
        // the STARTTLS advertisement — or an attacker who strips it — gets the
        // login and the message in cleartext. Certificate checking stays at
        // the library default.
        requireTLS: !config.smtp.secure,
        auth: { user: config.user, pass: config.password },
        connectionTimeout: config.connectTimeoutMs,
        greetingTimeout: config.connectTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
      });

      return {
        async send(message: OutboundMail): Promise<{ messageId: string }> {
          const info = await transport.sendMail({
            from: message.from,
            to: message.to,
            subject: message.subject,
            ...(message.text !== undefined && { text: message.text }),
            ...(message.html !== undefined && { html: message.html }),
            // Both headers: `In-Reply-To` names the parent, `References`
            // carries the thread, and clients need the pair to thread a reply.
            ...(message.inReplyTo !== undefined && {
              inReplyTo: message.inReplyTo,
              references: [message.inReplyTo],
            }),
          });
          return { messageId: info.messageId };
        },
        close(): Promise<void> {
          transport.close();
          return Promise.resolve();
        },
      };
    },
  };
}

/** What `imapflow` exposes of an open connection, narrowed to what the session
 * uses — so the helpers below stay readable without importing the class. */
interface ImapClientLike {
  mailbox: { exists: number } | false;
  list(): Promise<
    Array<{ path: string; flags: Set<string>; specialUse?: string }>
  >;
  search(
    query: { since?: Date; all?: boolean },
    options: { uid: true },
  ): Promise<number[] | false>;
  fetch(
    range: string | number[],
    query: { uid: true; envelope: true; internalDate: true },
    options?: { uid: true },
  ): AsyncIterableIterator<{
    uid: number;
    envelope?: {
      date?: Date;
      subject?: string;
      from?: Array<{ name?: string; address?: string }>;
    };
    internalDate?: Date | string;
  }>;
}

/** The IMAP path the selector names, resolving the Sent role against what the
 * server actually publishes. */
async function resolveMailboxPath(
  client: ImapClientLike,
  selector: MailboxSelector,
  pinnedSentMailbox: string | undefined,
): Promise<string> {
  if (selector.kind === 'inbox') return 'INBOX';
  if (selector.kind === 'named') return selector.path;
  const listed = await client.list();
  const discovered = discoverSentMailbox(listed, pinnedSentMailbox);
  if (!discovered) {
    throw new IntegrationError(
      'LIVE_BODY_FAILED',
      'this mail server publishes no Sent folder',
      {
        connector: CONNECTOR,
        action: 'list_messages',
        hint: 'pass the folder name as `mailbox` — servers spell it differently',
      },
    );
  }
  return discovered;
}

/**
 * The newest messages matching the cursor, oldest first.
 *
 * Only envelopes are fetched: the connector returns sender, subject, and time,
 * so pulling whole message sources would multiply the transfer and put message
 * bodies in memory for nothing. `SEARCH SINCE` is date-granular, so the
 * millisecond cursor is applied again here.
 */
async function fetchSummaries(
  client: ImapClientLike,
  query: MailboxQuery,
): Promise<readonly MailMessageSummary[]> {
  const summaries: MailMessageSummary[] = [];

  if (query.since !== undefined) {
    const found = await client.search(
      { since: new Date(query.since) },
      { uid: true },
    );
    const uids = (found === false ? [] : found).slice(-query.limit);
    if (uids.length === 0) return [];
    for await (const message of client.fetch(
      uids,
      { uid: true, envelope: true, internalDate: true },
      { uid: true },
    )) {
      summaries.push(toSummary(message));
    }
  } else {
    // No cursor: read the tail of the mailbox. IMAP has no negative offset, so
    // the range is derived from the message count the server reported when the
    // mailbox was opened.
    const exists = client.mailbox === false ? 0 : client.mailbox.exists;
    if (exists === 0) return [];
    const start = Math.max(1, exists - query.limit + 1);
    for await (const message of client.fetch(`${start}:*`, {
      uid: true,
      envelope: true,
      internalDate: true,
    })) {
      summaries.push(toSummary(message));
    }
  }

  const cursor = query.since;
  return summaries
    .filter((message) => cursor === undefined || message.sentAt >= cursor)
    .sort((a, b) => a.sentAt - b.sentAt)
    .slice(-query.limit);
}

function toSummary(message: {
  uid: number;
  envelope?: {
    date?: Date;
    subject?: string;
    from?: Array<{ name?: string; address?: string }>;
  };
  internalDate?: Date | string;
}): MailMessageSummary {
  const envelope = message.envelope;
  const sender = envelope?.from?.[0];
  const sentAt =
    envelope?.date instanceof Date
      ? envelope.date.getTime()
      : internalDateMs(message.internalDate);
  return {
    uid: String(message.uid),
    from: sender?.address ?? sender?.name ?? '',
    subject: envelope?.subject ?? '',
    sentAt,
  };
}

/** The server's own arrival time, used when a message carries no valid Date
 * header — an unparseable one would otherwise sort as the epoch. */
function internalDateMs(value: Date | string | undefined): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'string') {
    const parsed = Date.parse(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return 0;
}
