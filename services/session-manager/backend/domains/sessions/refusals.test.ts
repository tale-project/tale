// What the refusals tell besides their code: the cause of a proxy that does not
// answer, how many proxies failed, what a busy session is doing. The English
// sentence stays the answer of API and MCP clients; the page words the code in
// the person's language from these fields (`app/lib/api/failure.ts`).

import { describe, expect, it } from 'vitest';

import * as refuse from './refusals.ts';
import { StartError } from './runtime.ts';
import type { SessionState } from './runtime.ts';

const CAUSE = 'the proxy rejected the credentials (HTTP 407)';

function state(overrides: Partial<SessionState>): SessionState {
  return {
    status: 'stopped',
    activity: null,
    error: null,
    errorCode: null,
    errorExtra: null,
    ...overrides,
  };
}

describe('a proxy that does not answer', () => {
  it('names the cause and the proxy beside the sentence of a refused start', () => {
    const error = refuse.proxyUnreachableAtStart(
      'shop',
      'http://user@192.0.2.1:8080',
      CAUSE,
      7,
    );
    expect([error.status, error.code]).toEqual([502, 'proxy_unreachable']);
    expect(error.message).toBe(
      `The proxy of session shop (http://user@192.0.2.1:8080) is not working: ${CAUSE}. ` +
        'Use “Rotate IP” to give the session another proxy.',
    );
    expect(error.toBody()).toEqual({
      error: 'proxy_unreachable',
      message: error.message,
      proxyId: 7,
      reason: CAUSE,
    });
  });

  it('names them for the IP check of a session, too', () => {
    const error = refuse.proxyUnreachable('shop', 'connection refused', 7);
    expect([error.status, error.code]).toEqual([502, 'proxy_unreachable']);
    expect(error.message).toBe(
      'The proxy of session shop is not working: connection refused.',
    );
    expect(error.extra).toEqual({ proxyId: 7, reason: 'connection refused' });
  });

  it('gives the cause alone as the reason: no sentence around it, no password', () => {
    const error = refuse.proxyUnreachableAtStart(
      'shop',
      'http://user@192.0.2.1:8080',
      CAUSE,
      7,
    );
    expect(error.extra.reason).toBe(CAUSE);
    expect(JSON.stringify(error.extra)).not.toMatch(
      /is not working|Rotate IP|shop|pass/,
    );
  });

  it('shows the same details in the row of the session as in the answer', () => {
    const shown = refuse.proxyUnreachableSessionError(CAUSE, 7);
    expect(shown).toEqual({
      code: 'proxy_unreachable',
      message: `Its proxy is not working: ${CAUSE}. Use “Rotate IP” to give the session another proxy.`,
      extra: { proxyId: 7, reason: CAUSE },
    });
    expect(
      refuse.proxyUnreachableAtStart('shop', 'http://192.0.2.1:8080', CAUSE, 7)
        .extra,
    ).toEqual(shown.extra);
  });
});

describe('no working proxy', () => {
  it('says how many proxies failed their check', () => {
    const error = refuse.noWorkingProxy(3, 'start');
    expect(error).toBeInstanceOf(StartError);
    expect(error.code).toBe('no_working_proxy');
    expect(error.message).toBe(
      'No working proxy available (3 failed their check). Add proxies or re-check them, then start again.',
    );
    expect(error.extra).toEqual({ failed: 3 });
  });

  it('says nothing about a count when no proxy failed: they were all taken', () => {
    const error = refuse.noWorkingProxy(0, 'rotate');
    expect(error.code).toBe('no_working_proxy');
    expect(error.message).toBe(
      'No free proxy available: every session needs its own proxy. Add proxies, then rotate again.',
    );
    expect(error.extra).toEqual({});
  });
});

describe('an exit IP without a place', () => {
  it('names why the timezone and location cannot be matched', () => {
    const error = refuse.unknownIpLocation(
      'the GeoIP database has no location for 203.0.113.7',
    );
    expect(error).toBeInstanceOf(StartError);
    expect(error.code).toBe('unknown_ip_location');
    expect(error.message).toBe(
      'Cannot match timezone and location to the proxy: the GeoIP database has no location for 203.0.113.7.',
    );
    expect(error.extra).toEqual({
      reason: 'the GeoIP database has no location for 203.0.113.7',
    });
  });
});

describe('a session that is busy', () => {
  it.each([
    [
      'getting a proxy',
      state({ status: 'starting', activity: 'assigning_proxy' }),
      'assigning_proxy',
    ],
    [
      'getting a proxy (a rotation of a stopped session)',
      state({ status: 'stopped', activity: 'assigning_proxy' }),
      'assigning_proxy',
    ],
    [
      'starting',
      state({ status: 'starting', activity: 'launching' }),
      'starting',
    ],
    ['stopping', state({ status: 'stopping' }), 'stopping'],
  ] as const)('says what it is doing while %s', (_name, busy, doing) => {
    const error = refuse.sessionBusy('a', busy);
    expect([error.status, error.code]).toEqual([409, 'session_busy']);
    expect(error.extra).toEqual({ doing });
    expect(error.toBody()).toMatchObject({ error: 'session_busy', doing });
  });

  it.each([
    ['getting a proxy', state({ activity: 'assigning_proxy' })],
    ['starting', state({ status: 'starting' })],
    ['stopping', state({ status: 'stopping' })],
  ])('keeps the English sentence of a session that is %s', (words, busy) => {
    expect(refuse.sessionBusy('a', busy).message).toBe(
      `Session a is ${words}. Try again in a moment.`,
    );
  });

  it('says only that it is busy when it is doing nothing the app knows of', () => {
    const error = refuse.sessionBusy('a', state({ status: 'running' }));
    expect(error.message).toBe('Session a is busy. Try again in a moment.');
    expect(error.extra).toEqual({});
    expect(error.toBody()).toEqual({
      error: 'session_busy',
      message: error.message,
    });
  });
});
