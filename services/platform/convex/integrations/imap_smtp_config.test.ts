import { describe, it, expect, vi } from 'vitest';

import type { ActionCtx } from '../_generated/server';
import { resolveImapSmtpConnection } from './imap_smtp_config';
import type { LoadedIntegration } from './load_integration';

// Mock ctx: resolveImapSmtpConnection only calls ctx.runAction(decryptString).
// Return a marker so tests can tell a decrypted stored secret from a plaintext
// dry-run override.
function makeCtx(): ActionCtx {
  return {
    runAction: vi.fn(async (_ref: unknown, args: { jwe: string }) => {
      return `dec(${args.jwe})`;
    }),
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- minimal ctx stub for the one call the function makes
  } as unknown as ActionCtx;
}

function makeIntegration(
  // connectionConfig holds catchall keys (imapHost/smtpHost/…) that are typed
  // narrowly on LoadedIntegration but are `v.any()` at runtime — loosen it here.
  overrides: Partial<Omit<LoadedIntegration, 'connectionConfig'>> & {
    connectionConfig?: Record<string, unknown>;
  },
): LoadedIntegration {
  return {
    type: 'imap_smtp',
    connectionConfig: {
      imapHost: 'imap.example.com',
      imapPort: 993,
      imapSecure: 'true',
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpSecure: 'false',
    },
    basicAuth: { username: 'me@example.com', passwordEncrypted: 'IMAPJWE' },
    ...overrides,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- partial LoadedIntegration fixture for the fields this function reads
  } as LoadedIntegration;
}

describe('resolveImapSmtpConnection', () => {
  it('reuses the IMAP login for SMTP when no smtpAuth is set', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({}),
    );

    expect(conn.imap.user).toBe('me@example.com');
    expect(conn.imap.password).toBe('dec(IMAPJWE)');
    // SMTP falls back to the exact same decrypted IMAP credentials.
    expect(conn.smtp.user).toBe('me@example.com');
    expect(conn.smtp.password).toBe('dec(IMAPJWE)');
    // Port/secure parsing from the string-typed config.
    expect(conn.imap.port).toBe(993);
    expect(conn.imap.secure).toBe(true);
    expect(conn.smtp.port).toBe(587);
    expect(conn.smtp.secure).toBe(false);
  });

  it('uses a distinct smtpAuth for SMTP while IMAP keeps basicAuth', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({
        smtpAuth: { username: 'resend', passwordEncrypted: 'RESENDJWE' },
      }),
    );

    expect(conn.imap.user).toBe('me@example.com');
    expect(conn.imap.password).toBe('dec(IMAPJWE)');
    expect(conn.smtp.user).toBe('resend');
    expect(conn.smtp.password).toBe('dec(RESENDJWE)');
  });

  it('honours inline plaintext overrides for dry-run testing', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({}),
      {
        basicAuth: { username: 'imap-user', password: 'imap-pass' },
        smtpAuth: { username: 'resend', password: 're_live_key' },
      },
    );

    // Overrides are plaintext — never routed through decrypt.
    expect(conn.imap.user).toBe('imap-user');
    expect(conn.imap.password).toBe('imap-pass');
    expect(conn.smtp.user).toBe('resend');
    expect(conn.smtp.password).toBe('re_live_key');
  });

  it('falls back to the IMAP override for SMTP when only basicAuth is overridden', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({}),
      {
        basicAuth: { username: 'imap-user', password: 'imap-pass' },
      },
    );

    expect(conn.smtp.user).toBe('imap-user');
    expect(conn.smtp.password).toBe('imap-pass');
  });

  it('throws when the IMAP host is missing', async () => {
    await expect(
      resolveImapSmtpConnection(
        makeCtx(),
        makeIntegration({
          connectionConfig: { smtpHost: 'smtp.example.com' },
        }),
      ),
    ).rejects.toThrow(/IMAP host/i);
  });
});

// Two real mailbox accounts under one integration: `support@` (SMTP reuses the
// mailbox login) and `billing@` (a distinct SMTP relay). Hosts/ports/TLS are
// typed on the account, so no string parsing is involved.
const MULTI_ACCOUNTS = [
  {
    id: 'support',
    displayName: 'Support',
    fromAddress: 'support@acme.com',
    imapHost: 'imap.acme.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.acme.com',
    smtpPort: 587,
    smtpSecure: false,
    isDefault: true,
    imapAuth: {
      username: 'support@acme.com',
      passwordEncrypted: 'SUPPORT_IMAP',
    },
  },
  {
    id: 'billing',
    displayName: 'Billing',
    fromAddress: 'billing@acme.com',
    imapHost: 'imap.acme.com',
    imapPort: 993,
    imapSecure: true,
    smtpHost: 'smtp.sendgrid.net',
    smtpPort: 2525,
    smtpSecure: false,
    imapAuth: {
      username: 'billing@acme.com',
      passwordEncrypted: 'BILLING_IMAP',
    },
    smtpAuth: { username: 'apikey', passwordEncrypted: 'SENDGRID_KEY' },
  },
];

describe('resolveImapSmtpConnection — multi-account', () => {
  it('selects a specific account by accountId, IMAP + distinct SMTP relay', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({ imapSmtpAccounts: MULTI_ACCOUNTS }),
      { accountId: 'billing' },
    );

    expect(conn.imap.host).toBe('imap.acme.com');
    expect(conn.imap.user).toBe('billing@acme.com');
    expect(conn.imap.password).toBe('dec(BILLING_IMAP)');
    // The distinct SMTP relay login (provider-agnostic — here a SendGrid relay).
    expect(conn.smtp.host).toBe('smtp.sendgrid.net');
    expect(conn.smtp.port).toBe(2525);
    expect(conn.smtp.user).toBe('apikey');
    expect(conn.smtp.password).toBe('dec(SENDGRID_KEY)');
  });

  it('defaults to the isDefault account and reuses IMAP login for SMTP', async () => {
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({ imapSmtpAccounts: MULTI_ACCOUNTS }),
    );

    expect(conn.imap.user).toBe('support@acme.com');
    // support has no smtpAuth → SMTP falls back to the mailbox login.
    expect(conn.smtp.user).toBe('support@acme.com');
    expect(conn.smtp.password).toBe('dec(SUPPORT_IMAP)');
    // Typed host/port/secure straight off the account — no string parsing.
    expect(conn.imap.port).toBe(993);
    expect(conn.imap.secure).toBe(true);
    expect(conn.smtp.port).toBe(587);
    expect(conn.smtp.secure).toBe(false);
  });

  it('falls back to the first account when none is marked default', async () => {
    const noDefault = MULTI_ACCOUNTS.map((account) => ({
      ...account,
      isDefault: false,
    }));
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({ imapSmtpAccounts: noDefault }),
    );

    expect(conn.imap.user).toBe('support@acme.com');
  });

  it('throws when the requested accountId is not configured', async () => {
    await expect(
      resolveImapSmtpConnection(
        makeCtx(),
        makeIntegration({ imapSmtpAccounts: MULTI_ACCOUNTS }),
        { accountId: 'nope' },
      ),
    ).rejects.toThrow(/no mailbox account/i);
  });

  it('honours a legacy pre-save dry-run even when accounts are stored', async () => {
    // A pre-save "Test" passes inline legacy credentials/config; the dry-run
    // path is honoured over the stored accounts so the form can be validated
    // before it is saved.
    const conn = await resolveImapSmtpConnection(
      makeCtx(),
      makeIntegration({ imapSmtpAccounts: MULTI_ACCOUNTS }),
      {
        basicAuth: { username: 'dry@acme.com', password: 'dry-pass' },
        connectionConfig: {
          imapHost: 'imap.dry.com',
          smtpHost: 'smtp.dry.com',
        },
      },
    );

    expect(conn.imap.host).toBe('imap.dry.com');
    expect(conn.imap.user).toBe('dry@acme.com');
    expect(conn.imap.password).toBe('dry-pass');
  });
});
