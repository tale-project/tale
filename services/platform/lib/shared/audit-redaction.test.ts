import { describe, expect, it } from 'vitest';

import { redactSensitiveFields } from './audit-redaction';

describe('audit display redaction', () => {
  it('redacts secret keys case-insensitively without mutating stored data', () => {
    const metadata = {
      apiKey: 'hidden',
      PRIVATEKEY: 'hidden',
      cookieValue: 'hidden',
      authorization: 'hidden',
      lastFailedRunId: 'run-123',
      consecutiveFailures: 3,
      context: { attempts: [[{ refreshToken: 'hidden', reason: 'failure' }]] },
    };
    expect(redactSensitiveFields(metadata)).toEqual({
      apiKey: '[REDACTED]',
      PRIVATEKEY: '[REDACTED]',
      cookieValue: '[REDACTED]',
      authorization: '[REDACTED]',
      lastFailedRunId: 'run-123',
      consecutiveFailures: 3,
      context: {
        attempts: [[{ refreshToken: '[REDACTED]', reason: 'failure' }]],
      },
    });
    expect(metadata.apiKey).toBe('hidden');
    expect(metadata.context.attempts[0]?.[0]?.refreshToken).toBe('hidden');
  });

  it('preserves absent and empty metadata', () => {
    expect(redactSensitiveFields(undefined)).toBeUndefined();
    expect(redactSensitiveFields({})).toEqual({});
  });
});
