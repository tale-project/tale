import { describe, expect, it } from 'vitest';

import {
  isAgentRequest,
  isExpired,
  readAgentConsentRequest,
  redirectPlaceOf,
} from './agent-consent-request';

const SIGNED =
  '?response_type=code&client_id=https%3A%2F%2Fclaude.ai%2Foauth%2Fc.json&redirect_uri=http%3A%2F%2F127.0.0.1%3A54545%2Fcallback&scope=tale%3Amcp+tale%3Aautomations.write+offline_access&state=s&exp=1791000600&sig=bytes%2B';

describe('the request the consent page was opened with', () => {
  it('tells a coding agent’s request from a single sign-on by the scopes it asks for', () => {
    expect(isAgentRequest(SIGNED)).toBe(true);
    expect(isAgentRequest('?client_id=abc&scope=openid+profile+email')).toBe(
      false,
    );
    expect(isAgentRequest('?client_id=abc&scope=offline_access')).toBe(false);
    expect(isAgentRequest('?client_id=abc')).toBe(false);
    expect(isAgentRequest('')).toBe(false);
  });

  it('reads the app, the access and where the person goes back to, and keeps the query whole', () => {
    const request = readAgentConsentRequest(SIGNED);
    expect(request.clientId).toBe('https://claude.ai/oauth/c.json');
    expect(request.scope).toBe(
      'tale:mcp tale:automations.write offline_access',
    );
    expect(request.redirectUri).toBe('http://127.0.0.1:54545/callback');
    // The signature's bytes are not decoded or re-encoded.
    expect(request.query).toBe(SIGNED.slice(1));
    expect(request.query).toContain('sig=bytes%2B');
  });

  it('reads the challenge that names the request however often the provider signs it anew', () => {
    expect(
      readAgentConsentRequest('?client_id=abc&code_challenge=abc-DEF_123')
        .codeChallenge,
    ).toBe('abc-DEF_123');
    expect(readAgentConsentRequest(SIGNED).codeChallenge).toBeNull();
  });

  it('reads the expiry as seconds and says when the request has run out', () => {
    const request = readAgentConsentRequest(SIGNED);
    expect(request.expiresAt).toBe(1_791_000_600_000);
    expect(isExpired(request, 1_791_000_599_999)).toBe(false);
    expect(isExpired(request, 1_791_000_600_000)).toBe(true);
    expect(isExpired(request, 1_800_000_000_000)).toBe(true);
  });

  it('leaves a request that names no expiry, or an unreadable one, to the provider', () => {
    for (const search of ['?client_id=abc', '?exp=', '?exp=soon', '?exp=-5']) {
      const request = readAgentConsentRequest(search);
      expect(request.expiresAt, search).toBeNull();
      expect(isExpired(request, Date.now()), search).toBe(false);
    }
  });

  it('reads a query that arrives without its question mark, and one that names nothing', () => {
    expect(readAgentConsentRequest('client_id=abc&scope=tale%3Amcp')).toEqual({
      query: 'client_id=abc&scope=tale%3Amcp',
      clientId: 'abc',
      scope: 'tale:mcp',
      redirectUri: null,
      codeChallenge: null,
      expiresAt: null,
    });
    expect(readAgentConsentRequest('')).toEqual({
      query: '',
      clientId: '',
      scope: '',
      redirectUri: null,
      codeChallenge: null,
      expiresAt: null,
    });
  });
});

describe('where the person goes back to', () => {
  it('is this computer for a loopback address, whatever its port', () => {
    for (const uri of [
      'http://localhost:3118/cb',
      'http://127.0.0.1:54545/callback',
      'http://[::1]:8080/cb',
    ]) {
      expect(redirectPlaceOf(uri)?.loopback, uri).toBe(true);
    }
    expect(redirectPlaceOf('http://127.0.0.1:54545/callback')).toEqual({
      host: '127.0.0.1',
      loopback: true,
    });
  });

  it('is the host of a web address, and not this computer', () => {
    expect(redirectPlaceOf('https://claude.ai/api/mcp/auth_callback')).toEqual({
      host: 'claude.ai',
      loopback: false,
    });
    expect(redirectPlaceOf('https://localhost.evil.example/cb')?.loopback).toBe(
      false,
    );
  });

  it('is the scheme of an app’s own address', () => {
    expect(
      redirectPlaceOf('cursor://anysphere.cursor-mcp/oauth/callback'),
    ).toEqual({ host: 'anysphere.cursor-mcp', loopback: false });
    expect(redirectPlaceOf('myapp:/callback')).toEqual({
      host: 'myapp:',
      loopback: false,
    });
  });

  it('is nothing when there is no address that can be read', () => {
    expect(redirectPlaceOf(null)).toBeNull();
    expect(redirectPlaceOf('not a url')).toBeNull();
    expect(redirectPlaceOf('')).toBeNull();
  });
});
