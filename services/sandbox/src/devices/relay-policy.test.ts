import { describe, expect, test } from 'bun:test';

import {
  forwardableHeaders,
  relayAllows,
  relayEndpoint,
  relayMethodAllowed,
  relayPath,
  relayRequestHeaders,
} from './relay-policy.ts';

describe('relayAllows', () => {
  test.each([
    ['api', '/api/tools', true],
    ['api', '/api/tools/list', true],
    ['api', '/api/connectors/execute', true],
    ['api', '/api/connectors/hostcall', true],
    ['api', '/api/sandbox-blob?token=abc', true],
    ['api', '/api/toolsx', false],
    ['api', '/api/app/sandbox/limits', false],
    ['api', '/api/auth/sign-in', false],
    ['api', '/api/tools/../app/users', false],
    ['api', '/api/tools/%2e%2e/app', false],
    ['gateway', '/openai/v1/chat/completions', true],
    ['gateway', '/anthropic/v1/messages', true],
    ['gateway', '/genai/v1beta/models', true],
    ['gateway', '/api/governance/virtual-keys', false],
    ['gateway', '/', false],
    ['gateway', '/metrics', false],
  ] as const)('%s %s → %p', (relay, path, allowed) => {
    expect(relayAllows(relay, path)).toBe(allowed);
  });
});

describe('relayPath', () => {
  test('passes a canonical path through unchanged, query included', () => {
    expect(relayPath('api', '/api/sandbox-blob?token=a%20b')).toBe(
      '/api/sandbox-blob?token=a%20b',
    );
    expect(
      relayPath(
        'gateway',
        '/genai/v1beta/models/gemini-2.5-pro:generateContent',
      ),
    ).toBe('/genai/v1beta/models/gemini-2.5-pro:generateContent');
    expect(relayPath('api', '/api/connectors/acme%20crm/execute')).toBe(
      '/api/connectors/acme%20crm/execute',
    );
  });

  test.each([
    // Characters a URL parser silently drops or rewrites after the check.
    ['/openai/.\t./api/providers'],
    ['/openai/.\r./api/config'],
    ['/openai/.\n./api/config'],
    ['/openai/v1 /chat'],
    ['/openai/v1/ch\u00e4t'],
    // Dot segments, raw or escaped, and escapes that decode to separators.
    ['/openai/./v1'],
    ['/openai/%2e%2e/api/providers'],
    ['/openai/%2E/v1'],
    ['/openai/v1%2fchat'],
    ['/openai/v1%5cchat'],
    ['/openai/%252e%252e/api'],
    ['/openai/v1%00'],
    ['/openai/v1%3fx=1'],
    // Another host, a fragment, a backslash.
    ['//evil.example/openai/v1'],
    ['/openai/v1#frag'],
    ['/openai\\..\\api'],
    ['openai/v1'],
  ])('refuses %p', (path) => {
    expect(relayPath('gateway', path)).toBeNull();
  });
});

describe('relayMethodAllowed', () => {
  test('lets ordinary methods through and nothing else', () => {
    for (const method of ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE']) {
      expect(relayMethodAllowed(method)).toBe(true);
    }
    for (const method of ['TRACE', 'CONNECT', 'get', 'PROPFIND', '']) {
      expect(relayMethodAllowed(method)).toBe(false);
    }
  });
});

describe('relayRequestHeaders', () => {
  test('drops what would let a device speak for the client', () => {
    expect(
      relayRequestHeaders([
        ['authorization', 'Bearer k'],
        ['x-forwarded-for', '10.0.0.1'],
        ['X-Real-IP', '10.0.0.1'],
        ['forwarded', 'for=10.0.0.1'],
        ['cookie', 'session=x'],
        ['content-type', 'application/json'],
      ]),
    ).toEqual([
      ['authorization', 'Bearer k'],
      ['content-type', 'application/json'],
    ]);
  });
});

describe('forwardableHeaders', () => {
  test('drops hop-by-hop fields and anything claiming the spawner namespace', () => {
    expect(
      forwardableHeaders(
        new Headers({
          Authorization: 'Bearer k',
          Connection: 'keep-alive',
          'Transfer-Encoding': 'chunked',
          Host: 'backend-api:3005',
          'Content-Length': '12',
          'X-Tale-Sandbox-Device': 'forged',
          'X-Tale-Sandbox-Signature': 'forged',
          Accept: 'text/event-stream',
        }),
      ),
    ).toEqual([
      ['accept', 'text/event-stream'],
      ['authorization', 'Bearer k'],
    ]);
  });
});

describe('relayEndpoint', () => {
  test('reads the name and port a device answers on', () => {
    expect(relayEndpoint('http://backend-api:3005')).toEqual({
      hostname: 'backend-api',
      port: 3005,
    });
    expect(relayEndpoint('http://gw')).toEqual({ hostname: 'gw', port: 80 });
    expect(() => relayEndpoint('https://gateway.example')).toThrow(
      /plain http/,
    );
  });
});
