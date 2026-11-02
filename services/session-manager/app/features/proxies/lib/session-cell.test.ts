import { describe, expect, it } from 'vitest';

import { proxy, proxyCheck, sessionRef } from '@/tests/utils/fixtures';

import { sessionCellOf } from './session-cell';

const FAILED = proxyCheck({ status: 'failed', ok: false });

describe('sessionCellOf', () => {
  it('is free for a proxy nobody has and nothing stands in the way of', () => {
    expect(sessionCellOf(proxy())).toEqual({ kind: 'free' });
  });

  it.each(['unchecked', 'checking'] as const)(
    'is free while the proxy is %s: it is not known to be bad',
    (status) => {
      expect(
        sessionCellOf(proxy({ check: proxyCheck({ status, ok: null }) })),
      ).toEqual({ kind: 'free' });
    },
  );

  it('is the session that has the proxy, also when the proxy stopped working', () => {
    const session = sessionRef({ id: 8, name: 'work' });
    expect(sessionCellOf(proxy({ session, check: FAILED }))).toEqual({
      kind: 'session',
      session,
    });
  });

  it('is failed for a proxy that does not work and nobody has', () => {
    expect(sessionCellOf(proxy({ check: FAILED }))).toEqual({ kind: 'failed' });
  });

  it('is the session whose exit IP is the same for a proxy another session shares an IP with', () => {
    const other = sessionRef({ id: 3, name: '0003' });
    expect(sessionCellOf(proxy({ sameIpAs: other }))).toEqual({
      kind: 'same-ip',
      other,
    });
  });

  it('puts a failing proxy before its exit IP: the first thing wrong is the one to say', () => {
    expect(
      sessionCellOf(proxy({ check: FAILED, sameIpAs: sessionRef() })),
    ).toEqual({ kind: 'failed' });
  });
});
