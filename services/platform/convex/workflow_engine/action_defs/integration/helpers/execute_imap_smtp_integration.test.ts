import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../../../../_generated/server';
import type { LoadedIntegration } from '../../../../integrations/load_integration';
import { executeImapSmtpIntegration } from './execute_imap_smtp_integration';

vi.mock('../../../../integrations/imap_smtp_config', () => ({
  resolveImapSmtpConnection: vi.fn().mockResolvedValue({
    imap: {
      host: 'imap.example.com',
      port: 993,
      secure: true,
      user: 'user@example.com',
      password: 'secret',
    },
  }),
}));

describe('executeImapSmtpIntegration sent-folder resilience', () => {
  it('returns empty data instead of throwing when sent sync fails', async () => {
    const runAction = vi.fn().mockResolvedValue({
      success: false,
      error: 'Command failed',
      duration: 12,
    });

    const ctx = { runAction } as unknown as ActionCtx;
    const integration = {
      name: 'imap_smtp',
      connectionConfig: { sentMailbox: 'Sent Items' },
    } as unknown as LoadedIntegration;

    const result = await executeImapSmtpIntegration(
      ctx,
      integration,
      'list_messages',
      {
        mailbox: 'sent',
        maxResults: 25,
      },
    );

    expect(result.result.data).toEqual([]);
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sentFolder: true }),
    );
  });

  it('still throws for INBOX fetch failures', async () => {
    const runAction = vi.fn().mockResolvedValue({
      success: false,
      error: 'Command failed',
    });

    const ctx = { runAction } as unknown as ActionCtx;
    const integration = {
      name: 'imap_smtp',
      connectionConfig: {},
    } as LoadedIntegration;

    await expect(
      executeImapSmtpIntegration(ctx, integration, 'list_messages', {
        maxResults: 25,
      }),
    ).rejects.toThrow('IMAP fetch failed: Command failed');
  });
});
