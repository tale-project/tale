import { describe, expect, it } from 'vitest';

import type { LoadedIntegration } from './load_integration';
import { accountEmailFromIntegration } from './resolve_integration_account_email';

function makeIntegration(
  overrides: Partial<LoadedIntegration> = {},
): LoadedIntegration {
  return {
    _id: 'cred_1',
    _creationTime: 1,
    organizationId: 'org_1',
    name: 'imap_smtp',
    title: 'IMAP',
    status: 'active',
    isActive: true,
    authMethod: 'basic_auth',
    ...overrides,
  } as LoadedIntegration;
}

describe('accountEmailFromIntegration', () => {
  it('prefers fromAddress over mailbox username', () => {
    expect(
      accountEmailFromIntegration(
        makeIntegration({
          connectionConfig: {
            fromAddress: 'support@example.com',
          } as LoadedIntegration['connectionConfig'],
          basicAuth: {
            username: 'admin@example.com',
            passwordEncrypted: 'enc',
          },
        }),
      ),
    ).toBe('support@example.com');
  });

  it('falls back to basicAuth username when it looks like an email', () => {
    expect(
      accountEmailFromIntegration(
        makeIntegration({
          basicAuth: {
            username: 'hello@example.com',
            passwordEncrypted: 'enc',
          },
        }),
      ),
    ).toBe('hello@example.com');
  });

  it('returns undefined when no email-like address is configured', () => {
    expect(
      accountEmailFromIntegration(
        makeIntegration({
          basicAuth: { username: 'not-an-email', passwordEncrypted: 'enc' },
        }),
      ),
    ).toBeUndefined();
  });
});
