import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SsoProviderConfig } from '../types';
import { oauth2Adapter } from './adapter';

const config: SsoProviderConfig = {
  providerId: 'oauth2',
  issuer: 'https://auth.example.com',
  authorizationEndpoint: 'https://auth.example.com/authorize',
  tokenEndpoint: 'https://auth.example.com/token',
  userinfoEndpoint: 'https://auth.example.com/userinfo',
  clientId: 'client-123',
  clientSecret: 'secret-xyz',
  scopes: ['email', 'profile'],
};

function stubUserinfo(body: unknown): void {
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(
    new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('OAuth2 adapter — userinfo email boundary', () => {
  it('maps a userinfo payload with an email', async () => {
    stubUserinfo({ sub: 'user-1', email: 'user@example.com', name: 'User' });

    const info = await oauth2Adapter.getUserInfo(config, 'at');

    expect(info.externalId).toBe('user-1');
    expect(info.email).toBe('user@example.com');
  });

  it('refuses a payload without an email readably', async () => {
    stubUserinfo({ sub: 'user-1', name: 'No Mail' });

    await expect(oauth2Adapter.getUserInfo(config, 'at')).rejects.toThrow(
      /OAuth2 userinfo response carries no email/,
    );
  });

  it('reads the address from the mapped claim and ignores a plain email that differs [SSO-R19]', async () => {
    stubUserinfo({
      sub: 'user-1',
      upn: 'ada@example.com',
      email: 'mia@example.com',
    });

    const info = await oauth2Adapter.getUserInfo(
      { ...config, claimMappings: { email: 'upn' } },
      'at',
    );

    expect(info.email).toBe('ada@example.com');
  });

  it('refuses when the mapped claim is absent, even though email is present [SSO-R19]', async () => {
    stubUserinfo({ sub: 'user-1', email: 'mia@example.com' });

    await expect(
      oauth2Adapter.getUserInfo(
        { ...config, claimMappings: { email: 'upn' } },
        'at',
      ),
    ).rejects.toThrow(/OAuth2 userinfo response carries no email/);
  });
});
