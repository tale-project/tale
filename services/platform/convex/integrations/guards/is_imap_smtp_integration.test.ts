import { describe, it, expect } from 'vitest';

import { isImapSmtpIntegration } from './is_imap_smtp_integration';

describe('isImapSmtpIntegration', () => {
  it('returns true only for type imap_smtp', () => {
    expect(isImapSmtpIntegration({ type: 'imap_smtp' })).toBe(true);
  });

  it('returns false for other integration types', () => {
    expect(isImapSmtpIntegration({ type: 'rest_api' })).toBe(false);
    expect(isImapSmtpIntegration({ type: 'sql' })).toBe(false);
    expect(isImapSmtpIntegration({ type: 'unknown' })).toBe(false);
  });

  it('returns false when type is missing or undefined', () => {
    expect(isImapSmtpIntegration({})).toBe(false);
    expect(isImapSmtpIntegration({ type: undefined })).toBe(false);
  });

  it('narrows the type to imap_smtp for the compiler', () => {
    const integration: { type?: string; name?: string } = {
      type: 'imap_smtp',
      name: 'mailbox',
    };
    if (isImapSmtpIntegration(integration)) {
      // Compile-time assertion: `type` is narrowed to the literal 'imap_smtp'.
      const narrowed: 'imap_smtp' = integration.type;
      expect(narrowed).toBe('imap_smtp');
    } else {
      throw new Error('expected the guard to narrow an imap_smtp integration');
    }
  });
});
