import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { authorizationUrl } from './connector-oauth';

/**
 * The start URL says what a consent is FOR (#3711): an Add names no
 * credential, so the callback stores a new one; a Reconnect names the
 * credential it renews, and the server writes to exactly that one.
 */
describe('authorizationUrl', () => {
  beforeEach(() => {
    window.__ENV__ = { SITE_URL: 'https://tale.example', BASE_PATH: '/tale' };
  });
  afterEach(() => {
    delete window.__ENV__;
  });

  it('starts an Add without naming any credential', () => {
    const url = new URL(authorizationUrl('org-1', 'gmail', { kind: 'add' }));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://tale.example/tale/api/connectors/oauth2/start',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      connector: 'gmail',
      organizationId: 'org-1',
    });
  });

  it('starts a Reconnect naming the credential it renews', () => {
    const url = new URL(
      authorizationUrl('org-1', 'gmail', {
        kind: 'reconnect',
        credentialId: 'cred-sales',
      }),
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      connector: 'gmail',
      organizationId: 'org-1',
      credentialId: 'cred-sales',
    });
  });
});
