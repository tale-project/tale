import { describe, expect, it } from 'vitest';

import {
  buildBrokerDocument,
  emptyBrokerDraft,
  isBrokerDraftComplete,
  type BrokerDraft,
} from './broker-form';

/**
 * The draft→document shaping behind the subscription-broker form: blank
 * optionals are omitted so the schema defaults land, env-ref suffixes get
 * the reserved prefix, and invalid drafts come back as a message naming the
 * field — the same zod schema the server enforces, so a client-side refusal
 * matches the server's.
 */

function completeDraft(overrides: Partial<BrokerDraft> = {}): BrokerDraft {
  return {
    ...emptyBrokerDraft(),
    endpoint: 'https://broker.example.com/tokens',
    tokensPath: '$.tokens',
    tokenField: 'access_token',
    targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
    ...overrides,
  };
}

describe('buildBrokerDocument', () => {
  it('builds a minimal document and applies the schema defaults', () => {
    const result = buildBrokerDocument(completeDraft());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document).toEqual({
      endpoint: 'https://broker.example.com/tokens',
      httpMethod: 'GET',
      auth: { method: 'none' },
      responseMapping: {
        tokensPath: '$.tokens',
        tokenField: 'access_token',
      },
      targetEnvVar: 'CLAUDE_CODE_OAUTH_TOKEN',
      selection: 'random',
      timeoutMs: 10_000,
      maxResponseBytes: 262_144,
      expirySkewMs: 300_000,
    });
    // Blank optional fields are omitted entirely, not sent as empty strings.
    expect(result.document).not.toHaveProperty('authSecret');
    expect(result.document.responseMapping).not.toHaveProperty('statusField');
  });

  it('prefixes the broker secret env-ref and carries auth + mapping options', () => {
    const result = buildBrokerDocument(
      completeDraft({
        httpMethod: 'POST',
        authMethod: 'header',
        headerName: 'X-Broker-Token',
        authSecret: 'shhh',
        secretEnvSuffix: 'CLAUDE_POOL',
        statusField: 'status',
        activeValue: 'active',
        expiresField: 'expires_at',
        selection: 'round-robin',
        timeoutMs: '5000',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.document.auth).toEqual({
      method: 'header',
      headerName: 'X-Broker-Token',
      secretEnv: 'TALE_TOKEN_SOURCE_CLAUDE_POOL',
    });
    expect(result.document.authSecret).toBe('shhh');
    expect(result.document.responseMapping).toEqual({
      tokensPath: '$.tokens',
      tokenField: 'access_token',
      statusField: 'status',
      activeValue: 'active',
      expiresField: 'expires_at',
    });
    expect(result.document.selection).toBe('round-robin');
    expect(result.document.timeoutMs).toBe(5000);
  });

  it('refuses a non-https endpoint with a message naming the field', () => {
    const result = buildBrokerDocument(
      completeDraft({ endpoint: 'http://broker.internal/tokens' }),
    );

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/endpoint/);
  });

  it('refuses an out-of-range timeout via the shared schema bounds', () => {
    const result = buildBrokerDocument(completeDraft({ timeoutMs: '1' }));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.message).toMatch(/timeoutMs/);
  });
});

describe('isBrokerDraftComplete', () => {
  it('requires endpoint, mapping, and target variable', () => {
    expect(isBrokerDraftComplete(emptyBrokerDraft())).toBe(false);
    expect(isBrokerDraftComplete(completeDraft())).toBe(true);
  });

  it('requires the header name only for header auth', () => {
    expect(isBrokerDraftComplete(completeDraft({ authMethod: 'header' }))).toBe(
      false,
    );
    expect(
      isBrokerDraftComplete(
        completeDraft({ authMethod: 'header', headerName: 'X-Token' }),
      ),
    ).toBe(true);
    expect(isBrokerDraftComplete(completeDraft({ authMethod: 'bearer' }))).toBe(
      true,
    );
  });
});
