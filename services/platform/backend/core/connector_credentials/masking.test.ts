import { describe, expect, it } from 'vitest';

import { maskPayload, maskSecret } from './masking';

describe('maskSecret [CCRED-R1]', () => {
  it('excerpts first4…last2 of a normal-length secret', () => {
    expect(maskSecret('ghp_abcdef1234567890')).toBe('ghp_…90');
  });

  it('trims before excerpting so padding cannot shift the excerpt', () => {
    expect(maskSecret('  ghp_abcdef1234567890  ')).toBe('ghp_…90');
  });

  it('omits the preview entirely for secrets too short to excerpt safely', () => {
    expect(maskSecret('short')).toBeUndefined();
    expect(maskSecret('123456789')).toBeUndefined();
    expect(maskSecret('')).toBeUndefined();
  });

  it('never returns the input itself at the boundary length', () => {
    const boundary = 'ABCDEFGHIJ';
    expect(maskSecret(boundary)).toBe('ABCD…IJ');
    expect(maskSecret(boundary)).not.toBe(boundary);
  });
});

describe('maskPayload [CCRED-R1]', () => {
  it('previews the single token of api-key and bearer credentials', () => {
    expect(
      maskPayload({ authMethod: 'api-key', token: 'tvly-abcdef123456' }),
    ).toBe('tvly…56');
    expect(
      maskPayload({ authMethod: 'bearer', token: 'ghp_abcdef1234567890' }),
    ).toBe('ghp_…90');
  });

  it('previews the PASSWORD of a basic credential, never the username', () => {
    const preview = maskPayload({
      authMethod: 'basic',
      username: 'ops@example.com',
      password: 'atlassian-token-987654',
    });
    expect(preview).toBe('atla…54');
    expect(preview).not.toContain('example.com');
  });

  it('previews the ACCESS token of an oauth2 credential, never the refresh token', () => {
    const preview = maskPayload({
      authMethod: 'oauth2',
      accessToken: 'xoxb-access-123456',
      refreshToken: 'xoxr-refresh-999999',
    });
    expect(preview).toBe('xoxb…56');
    expect(preview).not.toContain('refresh');
  });

  it('previews the CLIENT SECRET of an app sign-in, never the access token fetched with it', () => {
    const preview = maskPayload({
      authMethod: 'client-credentials',
      tenantId: 'contoso.onmicrosoft.com',
      clientId: '11111111-2222-3333-4444-555555555555',
      clientSecret: 'Xy8Q~app-secret-value-42',
      accessToken: 'eyJ0eXAiOiJKV1QiLCJhbGciOi',
      expiresAt: 1,
    });
    expect(preview).toBe('Xy8Q…42');
    expect(preview).not.toContain('eyJ');
  });

  it('omits the preview when the method secret is too short', () => {
    expect(
      maskPayload({ authMethod: 'basic', username: 'bot', password: 'pw' }),
    ).toBeUndefined();
  });
});
