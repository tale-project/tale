/**
 * Resolve the IMAP + SMTP connection details for an imap_smtp integration.
 *
 * Host/port/TLS live in `connectionConfig` (rendered automatically by the
 * data-driven credentials form); the username + password live in `basicAuth`.
 * The single username/password pair authenticates both IMAP and SMTP, which is
 * the standard for a mailbox account.
 *
 * Shared by the execution branch (integration_action), the test-connection
 * branch, and the outbound send branch so the parsing/decryption logic lives in
 * exactly one place.
 */

import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import type {
  ImapCredentials,
  SmtpCredentials,
} from '../node_only/imap_smtp/types';
import type { LoadedIntegration } from './load_integration';

export interface ImapSmtpConnection {
  imap: ImapCredentials;
  smtp: SmtpCredentials;
}

interface Overrides {
  /** Plaintext IMAP/mailbox credentials for pre-save (dry-run) testing. */
  basicAuth?: { username: string; password: string };
  /** Plaintext SMTP credentials for pre-save testing (e.g. Resend). */
  smtpAuth?: { username: string; password: string };
  /** Ignore any stored smtpAuth and send through the mailbox login instead. */
  clearSmtpAuth?: boolean;
  /** Inline connection config for pre-save testing. */
  connectionConfig?: Record<string, unknown>;
  /**
   * Select a specific stored mailbox account by id (multi-account
   * integrations). Omitted ⇒ the account marked `isDefault`, else the first.
   */
  accountId?: string;
}

interface CredPair {
  user: string;
  password: string;
}

/**
 * Resolve one credential pair: inline plaintext (dry-run) wins, otherwise the
 * stored password is decrypted. The node action always receives plaintext —
 * same trust model as the SQL integration.
 */
async function resolveCredPair(
  ctx: ActionCtx,
  override: { username: string; password: string } | undefined,
  stored: { username: string; passwordEncrypted: string } | undefined,
  label: string,
): Promise<CredPair> {
  if (override) {
    if (!override.username || !override.password) {
      throw new Error(`Please provide both ${label} username and password.`);
    }
    return { user: override.username, password: override.password };
  }
  if (!stored) {
    throw new Error(`Please save the ${label} credentials first.`);
  }
  const password = await ctx.runAction(
    internal.lib.crypto.internal_actions.decryptString,
    { jwe: stored.passwordEncrypted },
  );
  return { user: stored.username, password };
}

/** Accept either a real boolean or the string "true"/"false" the form stores. */
function parseBool(value: unknown, fallback: boolean): boolean {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (value.toLowerCase() === 'true') return true;
    if (value.toLowerCase() === 'false') return false;
  }
  return fallback;
}

/** Accept either a number or a numeric string the form may store. */
function parsePort(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function requireString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() !== ''
    ? value.trim()
    : undefined;
}

type StoredImapSmtpAccount = NonNullable<
  LoadedIntegration['imapSmtpAccounts']
>[number];

/**
 * Pick the mailbox account to act on: an explicit id when given, otherwise the
 * account flagged `isDefault`, otherwise the first configured account.
 */
function selectImapSmtpAccount(
  accounts: readonly StoredImapSmtpAccount[],
  accountId: string | undefined,
): StoredImapSmtpAccount {
  if (accountId) {
    const match = accounts.find((account) => account.id === accountId);
    if (!match) {
      throw new Error(
        `No mailbox account "${accountId}" is configured on this integration.`,
      );
    }
    return match;
  }
  return accounts.find((account) => account.isDefault) ?? accounts[0];
}

/**
 * Resolve a connection from one stored account. Hosts/ports/TLS are already
 * typed on the account (no string parsing); IMAP uses the account's own login
 * and SMTP reuses it unless the account carries a distinct `smtpAuth`.
 */
async function resolveConnectionFromAccount(
  ctx: ActionCtx,
  account: StoredImapSmtpAccount,
  clearSmtpAuth: boolean,
): Promise<ImapSmtpConnection> {
  const imapCreds = await resolveCredPair(
    ctx,
    undefined,
    account.imapAuth,
    'mailbox',
  );
  const useSeparateSmtp = !clearSmtpAuth && Boolean(account.smtpAuth);
  const smtpCreds = useSeparateSmtp
    ? await resolveCredPair(ctx, undefined, account.smtpAuth, 'SMTP')
    : imapCreds;
  return {
    imap: {
      host: account.imapHost,
      port: account.imapPort,
      secure: account.imapSecure,
      user: imapCreds.user,
      password: imapCreds.password,
    },
    smtp: {
      host: account.smtpHost,
      port: account.smtpPort,
      secure: account.smtpSecure,
      user: smtpCreds.user,
      password: smtpCreds.password,
    },
  };
}

export async function resolveImapSmtpConnection(
  ctx: ActionCtx,
  integration: LoadedIntegration,
  overrides?: Overrides,
): Promise<ImapSmtpConnection> {
  // Multi-account integrations store one or more real mailboxes. Absent (or a
  // pre-save dry-run that passes inline legacy credentials/config) ⇒ fall
  // through to the single-mailbox path below, byte-for-byte today's behavior.
  const accounts = integration.imapSmtpAccounts;
  const hasLegacyDryRun = Boolean(
    overrides?.basicAuth || overrides?.smtpAuth || overrides?.connectionConfig,
  );
  if (accounts && accounts.length > 0 && !hasLegacyDryRun) {
    const account = selectImapSmtpAccount(accounts, overrides?.accountId);
    return resolveConnectionFromAccount(
      ctx,
      account,
      Boolean(overrides?.clearSmtpAuth),
    );
  }

  // Merge stored connection config with any inline (dry-run) override.
  const config: Record<string, unknown> = {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- connectionConfig is v.any() with catchall keys
    ...(integration.connectionConfig as Record<string, unknown> | undefined),
    ...overrides?.connectionConfig,
  };

  const imapHost = requireString(config.imapHost);
  const smtpHost = requireString(config.smtpHost);
  if (!imapHost) {
    throw new Error(
      'IMAP host is not configured. Set the IMAP host in the integration settings.',
    );
  }
  if (!smtpHost) {
    throw new Error(
      'SMTP host is not configured. Set the SMTP host in the integration settings.',
    );
  }

  // IMAP (receiving) always uses basicAuth.
  const imapCreds = await resolveCredPair(
    ctx,
    overrides?.basicAuth,
    integration.basicAuth,
    'mailbox',
  );

  // SMTP (sending) uses a distinct smtpAuth when configured (e.g. Resend:
  // `resend` + API key), otherwise it reuses the IMAP login. `clearSmtpAuth`
  // (the form's "separate SMTP provider" toggle turned off) forces the reuse
  // even when a separate smtpAuth is still stored.
  const useSeparateSmtp =
    !overrides?.clearSmtpAuth &&
    Boolean(overrides?.smtpAuth || integration.smtpAuth);
  const smtpCreds = useSeparateSmtp
    ? await resolveCredPair(
        ctx,
        overrides?.smtpAuth,
        integration.smtpAuth,
        'SMTP',
      )
    : imapCreds;

  const imapPort = parsePort(config.imapPort) ?? 993;
  const smtpPort = parsePort(config.smtpPort) ?? 587;

  return {
    imap: {
      host: imapHost,
      port: imapPort,
      // Implicit TLS is the default for the standard IMAPS port 993.
      secure: parseBool(config.imapSecure, imapPort === 993),
      user: imapCreds.user,
      password: imapCreds.password,
    },
    smtp: {
      host: smtpHost,
      port: smtpPort,
      // Port 465 is implicit TLS; 587/25 use STARTTLS (secure: false).
      secure: parseBool(config.smtpSecure, smtpPort === 465),
      user: smtpCreds.user,
      password: smtpCreds.password,
    },
  };
}
