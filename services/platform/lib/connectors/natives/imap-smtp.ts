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

import { resolveReplyFrom } from '../../shared/conversations/reply-from';
import type {
  NativeConnectorContext,
  NativeConnectorImpl,
} from '../dispatcher';
import { ConnectorError, type ConnectorErrorCode } from '../errors';

const CONNECTOR = 'imap-smtp';

/** Messages returned by one `list_messages` when the caller names no limit. */
const DEFAULT_LIMIT = 25;

/** Ceiling for one pass — a sync reads a window and advances its cursor, so an
 * unbounded limit would only trade progress for a timeout. */
const MAX_LIMIT = 100;

/** Standard IMAPS port: implicit TLS from the first byte. */
const IMAPS_PORT = 993;

/** Standard IMAP port: cleartext handshake upgraded by STARTTLS. */
const IMAP_PORT = 143;

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
  /** `true` → TLS from the first byte (993, 465). `false` → STARTTLS
   * (143, 587). Derived from the port for those well-known values. */
  readonly secure: boolean;
}

/** One mail server plus the login that authenticates against it. IMAP and SMTP
 * may share a mailbox account, or SMTP may use a separate relay login. */
export interface MailServerAuth extends MailServer {
  readonly user: string;
  readonly password: string;
}

/** Everything one invocation needs to reach the organization's mailbox. */
export interface MailboxConfig {
  readonly imap: MailServerAuth;
  readonly smtp: MailServerAuth;
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

/** One address as the conversation ingest helpers expect it. */
export interface MailAddress {
  readonly name?: string;
  readonly address: string;
}

/**
 * One attachment pulled out of a MIME part. Bytes travel as base64 so the
 * connector result stays JSON-safe across the Convex action boundary; sync
 * materializes them into org blob storage before ingest.
 */
export interface MailAttachment {
  readonly id: string;
  readonly filename: string;
  readonly contentType: string;
  readonly size: number;
  readonly contentId?: string;
  /** Present when the part's body fit under {@link MAX_ATTACHMENT_BYTES}. */
  readonly contentBase64?: string;
}

/**
 * Cap for attachment bytes returned inline from `get_message`. Deliberately
 * well under Convex's function-payload ceiling: base64 inflates by ~4/3, and
 * this string crosses the connector-action boundary before sync writes it to
 * blob storage. 5 MiB raw (≈6.7 MiB encoded) matches the repo's other
 * cross-a-Convex-boundary blob cap and covers ordinary mail attachments —
 * providers cap a whole message near 25 MB. A bigger part is listed as
 * metadata only rather than risking the pass.
 */
export const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;

/**
 * One message body plus the fields conversation ingest needs — Message-ID
 * idempotency, threading headers, and the envelope addresses.
 */
export interface MailMessageBody {
  readonly uid: string;
  readonly messageId: string;
  readonly from: readonly MailAddress[];
  readonly to: readonly MailAddress[];
  readonly cc: readonly MailAddress[];
  readonly subject: string;
  /** ISO-8601 when the message was sent, when known. */
  readonly date: string;
  readonly text?: string;
  readonly html?: string;
  readonly headers: {
    readonly 'message-id'?: string;
    readonly 'in-reply-to'?: string;
    readonly references?: string;
  };
  readonly flags?: readonly string[];
  readonly attachments?: readonly MailAttachment[];
}

export interface MailboxQuery {
  readonly mailbox: MailboxSelector;
  /** Epoch-ms cursor; messages at or after it are returned. */
  readonly since?: number;
  readonly limit: number;
}

export interface ImapSession {
  listMessages(query: MailboxQuery): Promise<readonly MailMessageSummary[]>;
  getMessage(
    uid: string,
    mailbox: MailboxSelector,
  ): Promise<MailMessageBody | null>;
  /** Release the session. Called from a `finally`, so it must not throw. */
  close(): Promise<void>;
}

/**
 * One outbound attachment. Bytes are NOT inlined here: the send lane presigns a
 * short-lived GET against the org's own blob store (the same `getFileUrl` the
 * Gmail/Graph send paths use) and the transport streams from that URL, so a
 * reply carries the files the sender attached without holding them in memory.
 */
export interface OutboundAttachment {
  readonly filename: string;
  readonly contentType?: string;
  /** Presigned org-blob GET the transport fetches the bytes from. */
  readonly url: string;
}

export interface OutboundMail {
  readonly from: string;
  readonly to: string;
  /** Carbon-copy recipients, already joined into one address-list line. */
  readonly cc?: string;
  readonly subject: string;
  readonly text?: string;
  readonly html?: string;
  /** Message-ID this replies to; the transport also carries it in
   * `References` so a client threads the reply. */
  readonly inReplyTo?: string;
  /** The thread's Message-ID chain (root … parent), sent as `References` so a
   * reply threads even when the client keys on the full chain, not just
   * `In-Reply-To`. Falls back to `[inReplyTo]` when omitted. */
  readonly references?: readonly string[];
  readonly attachments?: readonly OutboundAttachment[];
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
  ctx: NativeConnectorContext,
) => Promise<MailboxConfig> | MailboxConfig;

export interface MailNativeDeps {
  readonly transport: MailTransport;
  readonly resolveConfig?: MailboxConfigResolver;
}

// -------------------------------------------------------------------- helpers

function refuse(
  code: ConnectorErrorCode,
  action: string,
  message: string,
  hint?: string,
): ConnectorError {
  return new ConnectorError(code, message, {
    connector: CONNECTOR,
    action,
    ...(hint !== undefined && { hint }),
  });
}

/**
 * The mailbox's connection details, read from the credential the invocation
 * resolved: IMAP always uses `username`/`password`; SMTP uses that same pair
 * unless a separate relay login (`smtpUsername`/`smtpPassword`) is stored —
 * the 0.3 "Use a separate SMTP provider" path for Resend / SendGrid / SES.
 *
 * A credential that names no server is refused rather than guessed at: there
 * is no safe default host for someone else's mail, and inventing one would
 * either fail obscurely or send the login somewhere nobody chose. A deployment
 * that keeps mailbox servers elsewhere injects its own resolver.
 */
export function mailboxConfigFromCredential(
  ctx: NativeConnectorContext,
  action: string,
): MailboxConfig {
  const user = ctx.secrets.get('username').trim();
  const password = ctx.secrets.get('password');
  if (user === '' || password === '') {
    throw refuse(
      'CREDENTIAL_UNRESOLVED',
      action,
      'the mailbox credential carries no username and password',
      'reconnect the IMAP / SMTP mailbox in Settings → Connectors',
    );
  }

  // A half SMTP relay login is a corrupt credential — refuse rather than
  // silently falling back to the mailbox pair with one field of the relay.
  const smtpUser = ctx.secrets.get('smtpUsername').trim();
  const smtpPassword = ctx.secrets.get('smtpPassword');
  if ((smtpUser === '') !== (smtpPassword === '')) {
    throw refuse(
      'CREDENTIAL_UNRESOLVED',
      action,
      'the SMTP relay login is incomplete',
      're-enter both the SMTP username and password in Settings → Connectors',
    );
  }
  const useSeparateSmtp = smtpUser !== '' && smtpPassword !== '';

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
      'set the IMAP and SMTP servers on the credential in Settings → Connectors',
    );
  }

  // `tls` means TLS from the first byte (implicit); `starttls` upgrades a
  // plaintext connection, which the transport then REQUIRES — see
  // `nodeMailTransport`. Well-known ports always win over the shared
  // `security` field: the connector declares one mode for both servers, but
  // Gmail-style setups mix IMAPS 993 with submission 587, and a mismatched
  // pair (tls + 587, or starttls + 465) is exactly OpenSSL's
  // `wrong version number`. Defaults match the connector's declared defaults.
  const configuredSecure = configString(ctx, 'security', 'tls') !== 'starttls';
  const imapPort = configPort(ctx, 'imapPort', IMAPS_PORT);
  const smtpPort = configPort(
    ctx,
    'smtpPort',
    configuredSecure ? SMTPS_PORT : SUBMISSION_PORT,
  );
  const pinnedSent = configString(ctx, 'sentMailbox');

  return {
    imap: {
      host: imapHost,
      port: imapPort,
      secure: secureForPort(imapPort, configuredSecure),
      user,
      password,
    },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      secure: secureForPort(smtpPort, configuredSecure),
      user: useSeparateSmtp ? smtpUser : user,
      password: useSeparateSmtp ? smtpPassword : password,
    },
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
  ctx: NativeConnectorContext,
  key: string,
  fallback = '',
): string {
  const value = ctx.config[key];
  return typeof value === 'string' ? value.trim() : fallback;
}

/** Read a config field as a port number, falling back to `fallback` when it is
 * absent or not a usable port. */
function configPort(
  ctx: NativeConnectorContext,
  key: string,
  fallback: number,
): number {
  const value = ctx.config[key];
  const port = typeof value === 'number' ? value : Number(value);
  return Number.isInteger(port) && port > 0 && port <= 65535 ? port : fallback;
}

/**
 * Resolve whether a mail port speaks TLS from the first byte.
 *
 * Standard ports encode the mode themselves — 993/465 are implicit TLS,
 * 143/587 are STARTTLS — so a shared `security` select cannot override them
 * without producing OpenSSL's `wrong version number` (client starts TLS on a
 * plaintext greeting, or the reverse). Non-standard ports honour the
 * configured fallback.
 */
export function secureForPort(
  port: number,
  configuredSecure: boolean,
): boolean {
  if (port === IMAPS_PORT || port === SMTPS_PORT) return true;
  if (port === IMAP_PORT || port === SUBMISSION_PORT) return false;
  return configuredSecure;
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
        `[connectors] imap-smtp: closing the ${label} connection failed: ${error instanceof Error ? error.message : String(error)}`,
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

const sendAttachmentInput = z.object({
  name: z.string().min(1),
  contentType: z.string().optional(),
  size: z.number().optional(),
  url: z.string().min(1),
});

const sendInput = z.object({
  to: z.string().min(1),
  /** Carbon-copy recipients as one address-list line (`a@x, b@y`). */
  cc: z.string().optional(),
  /** The address to send as. Honoured only when it is the mailbox's own
   * address or a same-domain alias on a verified (non-public) domain —
   * `resolveReplyFrom`; anything else falls back to the configured From, so a
   * caller can never send as another domain or another person's consumer
   * mailbox. */
  from: z.string().optional(),
  subject: z.string(),
  text: z.string().optional(),
  html: z.string().optional(),
  inReplyTo: z.string().optional(),
  references: z.array(z.string()).optional(),
  attachments: z.array(sendAttachmentInput).optional(),
  /** When true, send From `notification@` on the mailbox domain so system
   * mail is distinct from conversation replies on the same SMTP account. */
  notificationSender: z.boolean().optional(),
});

/** From address for system notification mail on the mailbox's send domain. */
export function notificationSenderFrom(baseFrom: string): string {
  const at = baseFrom.lastIndexOf('@');
  if (at === -1) return baseFrom;
  return `notification@${baseFrom.slice(at + 1).toLowerCase()}`;
}

const getMessageInput = z.object({
  uid: z.string().min(1),
  mailbox: z.string().optional(),
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
): Readonly<Record<string, NativeConnectorImpl>> {
  const configFor = async (
    ctx: NativeConnectorContext,
    action: string,
  ): Promise<MailboxConfig> =>
    deps.resolveConfig
      ? await deps.resolveConfig(ctx)
      : mailboxConfigFromCredential(ctx, action);

  const listMessages: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
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

  const send: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
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
    // Cc is a header like To — a line break would end it and inject the rest as
    // its own headers, so it is checked before it reaches the transport.
    const cc = parsed.cc?.trim();
    if (cc !== undefined && cc !== '') {
      assertSingleLine(cc, 'cc', 'send');
    }
    for (const reference of parsed.references ?? []) {
      assertSingleLine(reference, 'references', 'send');
    }

    const requestedFrom = parsed.from?.trim();
    if (requestedFrom !== undefined && requestedFrom !== '') {
      assertSingleLine(requestedFrom, 'from', 'send');
    }
    const config = await configFor(ctx, 'send');
    // A message with no body at all still needs one part or the server has
    // nothing to deliver, so a text-less plain send carries an empty body; a
    // caller that sent HTML alone keeps exactly that.
    const text = parsed.text ?? (parsed.html === undefined ? '' : undefined);
    // The From lane: a same-domain alias the Inbox chose (support@ / billing@
    // on the mailbox's verified domain) goes out as itself; every other
    // request is the configured From. The guard lives HERE, not in the
    // caller, because the connector door is agent-reachable.
    const from =
      parsed.notificationSender === true
        ? notificationSenderFrom(config.from)
        : resolveReplyFrom(requestedFrom, config.from);
    const attachments: OutboundAttachment[] = (parsed.attachments ?? []).map(
      (att) =>
        att.contentType !== undefined
          ? { filename: att.name, url: att.url, contentType: att.contentType }
          : { filename: att.name, url: att.url },
    );
    const message: OutboundMail = {
      from,
      to,
      ...(cc !== undefined && cc !== '' && { cc }),
      subject: parsed.subject,
      ...(text !== undefined && { text }),
      ...(parsed.html !== undefined && { html: parsed.html }),
      ...(parsed.inReplyTo !== undefined && { inReplyTo: parsed.inReplyTo }),
      ...(parsed.references !== undefined &&
        parsed.references.length > 0 && { references: parsed.references }),
      ...(attachments.length > 0 && { attachments }),
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

  const getMessage: NativeConnectorImpl = async (
    input: unknown,
    ctx: NativeConnectorContext,
  ) => {
    const parsed = parseInput(getMessageInput, input, 'get_message');
    const uid = parsed.uid.trim();
    const numericUid = Number(uid);
    if (!Number.isInteger(numericUid) || numericUid <= 0) {
      throw refuse(
        'INPUT_INVALID',
        'get_message',
        `"${uid.slice(0, 120)}" is not a valid IMAP UID`,
        'pass the uid string returned from list_messages',
      );
    }
    const config = await configFor(ctx, 'get_message');
    const mailbox = selectMailbox(parsed.mailbox);
    const session = await deps.transport.openImap(config);
    const message = await withSession(session, 'IMAP', (imap) =>
      imap.getMessage(uid, mailbox),
    );
    if (message === null) {
      throw refuse(
        'LIVE_BODY_FAILED',
        'get_message',
        `no message with UID ${uid} in the requested mailbox`,
      );
    }
    // Shape matches EmailType enough for `normalizeEmails` / ingest: uid is
    // numeric, messageId is the RFC Message-ID (falling back to a synthetic
    // id so a malformed message can still be skipped on empty messageId).
    return {
      uid: message.uid,
      email: {
        uid: Number(message.uid),
        messageId: message.messageId,
        from: [...message.from],
        to: [...message.to],
        cc: [...message.cc],
        subject: message.subject,
        date: message.date,
        ...(message.text !== undefined && { text: message.text }),
        ...(message.html !== undefined && { html: message.html }),
        flags: message.flags ?? [],
        headers: message.headers,
        ...(message.attachments !== undefined &&
          message.attachments.length > 0 && {
            attachments: [...message.attachments],
          }),
      },
    };
  };

  return {
    'imap-smtp.list_messages': listMessages,
    'imap-smtp.get_message': getMessage,
    'imap-smtp.send': send,
  };
}

// -------------------------------------------------------------- the transport

/** Constructable IMAP client — the surface `openImap` actually calls. */
type ImapFlowInstance = ImapClientLike & {
  connect(): Promise<void>;
  close(): void;
  logout(): Promise<void>;
  getMailboxLock(path: string): Promise<{ release(): void }>;
};

type ImapFlowConstructor = new (
  options: Record<string, unknown>,
) => ImapFlowInstance;

/**
 * Pick the constructable `ImapFlow` class out of whatever shape the dynamic
 * import resolved to. Convex's bundler used to inline `imapflow`; the named
 * export then became a non-constructor (live runs failed with
 * `"t is not a constructor"`). The package is now on `node.externalPackages`
 * so Node loads the real CJS export — this still tolerates the dual
 * named/default shapes ESM interop can produce.
 */
export function resolveImapFlowConstructor(mod: unknown): ImapFlowConstructor {
  if (typeof mod !== 'object' || mod === null) {
    throw new Error('imapflow module did not load as an object');
  }
  const record = mod as {
    ImapFlow?: unknown;
    default?: unknown;
  };
  const fromNamed = record.ImapFlow;
  if (typeof fromNamed === 'function') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop: the runtime shape is only known to be callable
    return fromNamed as ImapFlowConstructor;
  }
  const fromDefault = record.default;
  if (typeof fromDefault === 'function') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see the named-export branch above
    return fromDefault as ImapFlowConstructor;
  }
  if (
    typeof fromDefault === 'object' &&
    fromDefault !== null &&
    typeof (fromDefault as { ImapFlow?: unknown }).ImapFlow === 'function'
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see the named-export branch above
    return (fromDefault as { ImapFlow: ImapFlowConstructor }).ImapFlow;
  }
  throw new Error(
    'imapflow loaded without an ImapFlow constructor — ensure it is listed under convex.json node.externalPackages',
  );
}

export function resolveNodemailerCreateTransport(mod: unknown): (
  options: Record<string, unknown>,
) => {
  sendMail: (mail: Record<string, unknown>) => Promise<{ messageId?: string }>;
  close: () => void;
} {
  if (typeof mod !== 'object' || mod === null) {
    throw new Error('nodemailer module did not load as an object');
  }
  const record = mod as {
    createTransport?: unknown;
    default?: { createTransport?: unknown };
  };
  const createTransport =
    record.createTransport ?? record.default?.createTransport;
  if (typeof createTransport !== 'function') {
    throw new Error(
      'nodemailer loaded without createTransport — ensure it is listed under convex.json node.externalPackages',
    );
  }
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see resolveImapFlowConstructor
  return createTransport as (options: Record<string, unknown>) => {
    sendMail: (
      mail: Record<string, unknown>,
    ) => Promise<{ messageId?: string }>;
    close: () => void;
  };
}

type ParsedAddress = { address?: string; name?: string };
type ParsedAddressObject = {
  value?: ParsedAddress[];
  text?: string;
};

type ParsedMailAttachment = {
  filename?: string | false;
  contentType?: string;
  size?: number;
  contentId?: string;
  cid?: string;
  content?: Buffer | Uint8Array | string;
};

type SimpleParser = (source: Buffer | string) => Promise<{
  text?: string;
  html?: string | false;
  subject?: string;
  date?: Date;
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
  from?: ParsedAddressObject;
  to?: ParsedAddressObject;
  cc?: ParsedAddressObject;
  attachments?: ParsedMailAttachment[];
}>;

/**
 * Map mailparser attachment parts into the connector's attachment shape.
 * Oversized parts keep metadata only — sync still lists the file, but bytes
 * must be fetched another way (not yet wired for IMAP).
 */
export function mailAttachmentsFromParsed(
  attachments: readonly ParsedMailAttachment[] | undefined,
): MailAttachment[] {
  if (!attachments || attachments.length === 0) return [];
  const out: MailAttachment[] = [];
  for (let i = 0; i < attachments.length; i++) {
    const part = attachments[i];
    if (part === undefined) continue;
    const filename =
      typeof part.filename === 'string' && part.filename.trim() !== ''
        ? part.filename
        : `attachment-${i + 1}`;
    const contentType =
      typeof part.contentType === 'string' && part.contentType.trim() !== ''
        ? part.contentType
        : 'application/octet-stream';
    const contentIdRaw =
      typeof part.contentId === 'string' && part.contentId.trim() !== ''
        ? part.contentId
        : typeof part.cid === 'string' && part.cid.trim() !== ''
          ? part.cid
          : undefined;
    const contentId =
      contentIdRaw !== undefined
        ? contentIdRaw.replace(/^<|>$/g, '')
        : undefined;
    const bytes = attachmentBytes(part.content);
    const size =
      typeof part.size === 'number' && Number.isFinite(part.size)
        ? part.size
        : (bytes?.byteLength ?? 0);
    const id =
      contentId !== undefined && contentId !== ''
        ? contentId
        : `att-${i + 1}-${filename}`;
    const mapped: MailAttachment = {
      id,
      filename,
      contentType,
      size,
      ...(contentId !== undefined && contentId !== '' && { contentId }),
    };
    if (bytes !== null && bytes.byteLength <= MAX_ATTACHMENT_BYTES) {
      out.push({
        ...mapped,
        contentBase64: Buffer.from(bytes).toString('base64'),
      });
    } else {
      out.push(mapped);
    }
  }
  return out;
}

function attachmentBytes(
  content: Buffer | Uint8Array | string | undefined,
): Uint8Array | null {
  if (content === undefined) return null;
  if (typeof content === 'string') {
    if (content.length === 0) return null;
    return new TextEncoder().encode(content);
  }
  if (content.byteLength === 0) return null;
  // `Buffer` IS a `Uint8Array` (a view into a pooled ArrayBuffer), so one
  // branch covers both wire shapes. Callers must go through `Buffer.from(view)`
  // rather than `view.buffer`, which would read the whole pool.
  return content;
}

/** Same interop story as {@link resolveImapFlowConstructor} for mailparser. */
export function resolveSimpleParser(mod: unknown): SimpleParser {
  if (typeof mod !== 'object' || mod === null) {
    throw new Error('mailparser module did not load as an object');
  }
  const record = mod as {
    simpleParser?: unknown;
    default?: unknown;
  };
  const fromNamed = record.simpleParser;
  if (typeof fromNamed === 'function') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see resolveImapFlowConstructor
    return fromNamed as SimpleParser;
  }
  const fromDefault = record.default;
  if (typeof fromDefault === 'function') {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see resolveImapFlowConstructor
    return fromDefault as SimpleParser;
  }
  if (
    typeof fromDefault === 'object' &&
    fromDefault !== null &&
    typeof (fromDefault as { simpleParser?: unknown }).simpleParser ===
      'function'
  ) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- ESM/CJS interop; see resolveImapFlowConstructor
    return (fromDefault as { simpleParser: SimpleParser }).simpleParser;
  }
  throw new Error(
    'mailparser loaded without simpleParser — ensure it is listed under convex.json node.externalPackages',
  );
}

function referencesHeader(
  value: string | string[] | undefined,
): string | undefined {
  if (value === undefined) return undefined;
  if (Array.isArray(value)) {
    const joined = value
      .map((entry) => entry.trim())
      .filter((entry) => entry !== '')
      .join(' ');
    return joined === '' ? undefined : joined;
  }
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

function addressList(value: ParsedAddressObject | undefined): MailAddress[] {
  if (!value?.value || !Array.isArray(value.value)) return [];
  const out: MailAddress[] = [];
  for (const entry of value.value) {
    const address =
      typeof entry.address === 'string' ? entry.address.trim() : '';
    if (address === '') continue;
    const name = typeof entry.name === 'string' ? entry.name.trim() : '';
    out.push(name !== '' ? { name, address } : { address });
  }
  return out;
}

function threadingHeaders(parsed: {
  messageId?: string;
  inReplyTo?: string;
  references?: string | string[];
}): MailMessageBody['headers'] {
  const messageId =
    typeof parsed.messageId === 'string' && parsed.messageId.trim() !== ''
      ? parsed.messageId.trim()
      : undefined;
  const inReplyTo =
    typeof parsed.inReplyTo === 'string' && parsed.inReplyTo.trim() !== ''
      ? parsed.inReplyTo.trim()
      : undefined;
  const references = referencesHeader(parsed.references);
  return {
    ...(messageId !== undefined && { 'message-id': messageId }),
    ...(inReplyTo !== undefined && { 'in-reply-to': inReplyTo }),
    ...(references !== undefined && { references }),
  };
}

/**
 * The real transport: IMAP through `imapflow`, SMTP through `nodemailer`.
 *
 * Both clients are loaded on first use so a deployment that never opens a
 * mailbox never pays for them, and so the unit tests around the actions above
 * run with no mail libraries loaded at all. Both packages are Convex
 * `externalPackages` so the Node runtime loads their real constructors —
 * bundling them produced `"t is not a constructor"` on live runs.
 */
export function nodeMailTransport(): MailTransport {
  return {
    async openImap(config: MailboxConfig): Promise<ImapSession> {
      const ImapFlow = resolveImapFlowConstructor(await import('imapflow'));
      const client = new ImapFlow({
        host: config.imap.host,
        port: config.imap.port,
        secure: config.imap.secure,
        auth: { user: config.imap.user, pass: config.imap.password },
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
        async getMessage(
          uid: string,
          mailbox: MailboxSelector,
        ): Promise<MailMessageBody | null> {
          const path = await resolveMailboxPath(
            client,
            mailbox,
            config.sentMailbox,
          );
          const lock = await client.getMailboxLock(path);
          try {
            return await fetchMessageBody(client, uid);
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
      const createTransport = resolveNodemailerCreateTransport(
        await import('nodemailer'),
      );
      const transport = createTransport({
        host: config.smtp.host,
        port: config.smtp.port,
        secure: config.smtp.secure,
        // Fail closed on the STARTTLS path: without this, a server that omits
        // the STARTTLS advertisement — or an attacker who strips it — gets the
        // login and the message in cleartext. Certificate checking stays at
        // the library default.
        requireTLS: !config.smtp.secure,
        auth: { user: config.smtp.user, pass: config.smtp.password },
        connectionTimeout: config.connectTimeoutMs,
        greetingTimeout: config.connectTimeoutMs,
        socketTimeout: config.socketTimeoutMs,
      });

      return {
        async send(message: OutboundMail): Promise<{ messageId: string }> {
          // `In-Reply-To` names the parent; `References` carries the thread and
          // clients need the pair to thread a reply. Prefer the caller's full
          // chain, falling back to the parent alone.
          const references =
            message.references !== undefined && message.references.length > 0
              ? [...message.references]
              : message.inReplyTo !== undefined
                ? [message.inReplyTo]
                : undefined;
          const info = await transport.sendMail({
            from: message.from,
            to: message.to,
            ...(message.cc !== undefined && { cc: message.cc }),
            subject: message.subject,
            ...(message.text !== undefined && { text: message.text }),
            ...(message.html !== undefined && { html: message.html }),
            ...(message.inReplyTo !== undefined && {
              inReplyTo: message.inReplyTo,
            }),
            ...(references !== undefined && { references }),
            // Stream each part from its presigned org-blob GET rather than
            // buffering the bytes here.
            ...(message.attachments !== undefined &&
              message.attachments.length > 0 && {
                attachments: message.attachments.map((att) =>
                  att.contentType !== undefined
                    ? {
                        filename: att.filename,
                        path: att.url,
                        contentType: att.contentType,
                      }
                    : { filename: att.filename, path: att.url },
                ),
              }),
          });
          // Empty falls through to the action's own Message-ID check.
          return { messageId: info.messageId ?? '' };
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
  fetchOne(
    uid: number,
    query: { uid: true; source: true; flags: true },
    options: { uid: true },
  ): Promise<
    | {
        uid: number;
        source?: Buffer;
        flags?: Set<string>;
      }
    | false
  >;
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
    throw new ConnectorError(
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
export async function fetchSummaries(
  client: ImapClientLike,
  query: MailboxQuery,
): Promise<readonly MailMessageSummary[]> {
  const summaries: MailMessageSummary[] = [];

  if (query.since !== undefined) {
    const found = await client.search(
      { since: new Date(query.since) },
      { uid: true },
    );
    // Oldest first: a cursored pass DRAINS forward, so it takes the OLDEST
    // window after the cursor (SEARCH returns UIDs ascending ≈ arrival order).
    // The watermark then advances over this window and the next pass continues.
    // Taking the newest window instead would re-read the tail every pass and
    // strand everything older than it behind the advancing cursor — the loss
    // this drains against.
    const uids = (found === false ? [] : found).slice(0, query.limit);
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
  const ordered = summaries
    .filter((message) => cursor === undefined || message.sentAt >= cursor)
    .sort((a, b) => a.sentAt - b.sentAt);
  // A cursored pass keeps the OLDEST window (drain forward from the watermark);
  // the initial no-cursor pass keeps the newest tail.
  return cursor === undefined
    ? ordered.slice(-query.limit)
    : ordered.slice(0, query.limit);
}

async function fetchMessageBody(
  client: ImapClientLike,
  uid: string,
): Promise<MailMessageBody | null> {
  const numericUid = Number(uid);
  if (!Number.isInteger(numericUid) || numericUid <= 0) return null;
  const message = await client.fetchOne(
    numericUid,
    { uid: true, source: true, flags: true },
    { uid: true },
  );
  if (message === false || !message.source) return null;
  const simpleParser = resolveSimpleParser(await import('mailparser'));
  const parsed = await simpleParser(message.source);
  const flags = message.flags ? Array.from(message.flags) : [];
  const text =
    typeof parsed.text === 'string' && parsed.text !== ''
      ? parsed.text
      : undefined;
  const html =
    typeof parsed.html === 'string' && parsed.html !== ''
      ? parsed.html
      : undefined;
  const headers = threadingHeaders(parsed);
  const messageId =
    headers['message-id'] ?? `<imap-uid-${message.uid}@local.invalid>`;
  const date =
    parsed.date instanceof Date && Number.isFinite(parsed.date.getTime())
      ? parsed.date.toISOString()
      : new Date(0).toISOString();
  const attachments = mailAttachmentsFromParsed(parsed.attachments);
  return {
    uid: String(message.uid),
    messageId,
    from: addressList(parsed.from),
    to: addressList(parsed.to),
    cc: addressList(parsed.cc),
    subject: typeof parsed.subject === 'string' ? parsed.subject : '',
    date,
    ...(text !== undefined && { text }),
    ...(html !== undefined && { html }),
    headers,
    flags,
    ...(attachments.length > 0 && { attachments }),
  };
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
