import { afterEach, describe, expect, it, vi } from 'vitest';

import type { SsoProviderConfig } from '../types';
import { entraIdAdapter } from './adapter';

// `getUserInfo` ignores the config (reads the signed-in user from Graph `/me`),
// so a bare cast is enough to exercise the response mapping.
const fakeConfig = {} as unknown as SsoProviderConfig;

function stubGraphMe(data: Record<string, unknown>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () => ({ ok: true, json: async () => data }) as unknown as Response,
    ),
  );
}

describe('entraIdAdapter.getUserInfo — jobTitle normalisation (SSO serverError regression)', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps Graph `jobTitle: null` to undefined so a title-less user can sign in', async () => {
    // Microsoft Graph returns `jobTitle: null` for users with no job title;
    // leaking that null tripped `handleSsoLogin`'s `v.optional(v.string())`
    // validator and failed the whole login with a generic serverError.
    stubGraphMe({
      id: 'user-1',
      mail: 'user@example.com',
      displayName: 'User One',
      jobTitle: null,
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBeUndefined();
    expect(info.externalId).toBe('user-1');
    expect(info.email).toBe('user@example.com');
  });

  it('preserves a real job title', async () => {
    stubGraphMe({
      id: 'user-2',
      mail: 'eng@example.com',
      displayName: 'Eng Two',
      jobTitle: 'Software Engineer',
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBe('Software Engineer');
  });

  it('maps an empty-string job title to undefined', async () => {
    stubGraphMe({
      id: 'user-3',
      mail: 'x@example.com',
      displayName: 'X',
      jobTitle: '',
    });

    const info = await entraIdAdapter.getUserInfo(fakeConfig, 'access-token');

    expect(info.jobTitle).toBeUndefined();
  });
});
