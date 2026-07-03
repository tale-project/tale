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
