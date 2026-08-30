import { describe, expect, it, vi } from 'vitest';

import { AppError } from '../../lib/shared/errors/app-error';
import {
  buildActionableEmailInput,
  pickSendableMailbox,
  sendActionableEmail,
} from './send_actionable_email';

describe('pickSendableMailbox', () => {
  it('prefers imap-smtp over oauth mailboxes', () => {
    expect(
      pickSendableMailbox([
        {
          credentialId: 'gmail_1',
          connectorSlug: 'gmail',
          isDefault: true,
        },
        {
          credentialId: 'smtp_1',
          connectorSlug: 'imap-smtp',
          isDefault: false,
        },
      ]),
    ).toEqual({
      connectorSlug: 'imap-smtp',
      credentialId: 'smtp_1',
    });
  });

  it('prefers the default credential within a slug', () => {
    expect(
      pickSendableMailbox([
        {
          credentialId: 'gmail_other',
          connectorSlug: 'gmail',
          isDefault: false,
        },
        {
          credentialId: 'gmail_default',
          connectorSlug: 'gmail',
          isDefault: true,
        },
      ]),
    ).toEqual({
      connectorSlug: 'gmail',
      credentialId: 'gmail_default',
    });
  });

  it('falls back to outlook when nothing else is active', () => {
    expect(
      pickSendableMailbox([
        {
          credentialId: 'outlook_1',
          connectorSlug: 'outlook',
          isDefault: true,
        },
      ]),
    ).toEqual({
      connectorSlug: 'outlook',
      credentialId: 'outlook_1',
    });
  });

  it('returns null when no mail credentials are active', () => {
    expect(pickSendableMailbox([])).toBeNull();
  });
});

describe('buildActionableEmailInput', () => {
  it('asks imap-smtp to send as the notification sender', () => {
    expect(
      buildActionableEmailInput('imap-smtp', {
        to: 'user@example.com',
        subject: 'Assigned',
        text: 'plain',
        html: '<p>html</p>',
      }),
    ).toEqual({
      to: 'user@example.com',
      subject: 'Assigned',
      text: 'plain',
      html: '<p>html</p>',
      notificationSender: true,
    });
  });

  it('shapes gmail and outlook like conversation HTML sends', () => {
    expect(
      buildActionableEmailInput('gmail', {
        to: 'user@example.com',
        subject: 'Assigned',
        text: 'plain',
        html: '<p>html</p>',
      }),
    ).toEqual({
      to: 'user@example.com',
      subject: 'Assigned',
      body: '<p>html</p>',
      contentType: 'HTML',
    });

    expect(
      buildActionableEmailInput('outlook', {
        to: 'user@example.com',
        subject: 'Assigned',
        text: 'plain',
        html: '<p>html</p>',
      }),
    ).toEqual({
      to: ['user@example.com'],
      subject: 'Assigned',
      body: '<p>html</p>',
      contentType: 'HTML',
    });
  });
});

describe('sendActionableEmail', () => {
  it('invokes the connector send action live as a system caller', async () => {
    const runAction = vi.fn(async () => ({
      status: 'ok' as const,
      connector: 'imap-smtp',
      action: 'send',
      nodeType: 'imap-smtp.send',
      mode: 'live' as const,
      backend: 'native' as const,
      effects: 'write' as const,
      output: { messageId: '<1@example.com>' },
    }));
    const ctx = { runAction } as never;

    const result = await sendActionableEmail(ctx, {
      organizationId: 'org_1',
      mailbox: {
        connectorSlug: 'imap-smtp',
        credentialId: 'cred_1',
      },
      to: 'user@example.com',
      subject: 'Assigned',
      text: 'plain',
      html: '<p>html</p>',
    });

    expect(result).toEqual({ success: true });
    expect(runAction).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        organizationId: 'org_1',
        connector: 'imap-smtp',
        action: 'send',
        credentialRef: 'cred_1',
        mode: 'live',
        caller: {
          kind: 'system',
          reason: 'actionable notification email',
        },
        input: {
          to: 'user@example.com',
          subject: 'Assigned',
          text: 'plain',
          html: '<p>html</p>',
          notificationSender: true,
        },
      }),
    );
  });

  it('returns the connector error when the send refuses', async () => {
    const runAction = vi.fn(async () => {
      throw new AppError({
        code: 'CREDENTIAL_NONE_CONFIGURED',
        message: 'No default credential is configured for "gmail".',
      });
    });
    const ctx = { runAction } as never;

    const result = await sendActionableEmail(ctx, {
      organizationId: 'org_1',
      mailbox: {
        connectorSlug: 'gmail',
        credentialId: 'cred_gmail',
      },
      to: 'user@example.com',
      subject: 'Assigned',
      text: 'plain',
      html: '<p>html</p>',
    });

    expect(result).toEqual({
      success: false,
      error: 'No default credential is configured for "gmail".',
    });
  });

  it('returns approval-required as a failed send', async () => {
    const runAction = vi.fn(async () => ({
      status: 'approval-required' as const,
      connector: 'gmail',
      action: 'send_message',
      nodeType: 'gmail.send_message',
      message: 'approval needed',
    }));
    const ctx = { runAction } as never;

    const result = await sendActionableEmail(ctx, {
      organizationId: 'org_1',
      mailbox: {
        connectorSlug: 'gmail',
        credentialId: 'cred_gmail',
      },
      to: 'user@example.com',
      subject: 'Assigned',
      text: 'plain',
      html: '<p>html</p>',
    });

    expect(result).toEqual({
      success: false,
      error: 'approval needed',
    });
  });
});
