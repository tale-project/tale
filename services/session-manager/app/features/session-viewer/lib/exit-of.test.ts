import { describe, expect, it } from 'vitest';

import { runningSession, session } from '@/tests/utils/fixtures';

import { exitOf } from './exit-of';

describe('exitOf', () => {
  it('is the IP its proxy exits through, with the country', () => {
    expect(exitOf(runningSession())).toEqual({
      ip: '203.0.113.7',
      line: '203.0.113.7 · DE',
    });
  });

  it('is the IP of the place when the proxy is not known', () => {
    expect(exitOf(runningSession({ proxy: null }))).toEqual({
      ip: '203.0.113.7',
      line: '203.0.113.7 · DE',
    });
  });

  it('prefers what the proxy says now to the place it started with', () => {
    const moved = runningSession();
    const exit = exitOf({
      ...moved,
      proxy: moved.proxy && {
        ...moved.proxy,
        exitIp: '203.0.113.99',
        country: 'FR',
      },
    });
    expect(exit?.line).toBe('203.0.113.99 · FR');
  });

  it('is the IP alone when no country is known', () => {
    const running = runningSession();
    expect(
      exitOf({
        ...running,
        proxy: running.proxy && { ...running.proxy, country: null },
        location: running.location && { ...running.location, country: '' },
      })?.line,
    ).toBe('203.0.113.7');
  });

  it('is nothing for a session that has no IP yet', () => {
    expect(exitOf(session())).toBeNull();
    expect(
      exitOf(
        session({
          proxy: {
            id: 1,
            display: 'http://198.51.100.4:8080',
            exitIp: null,
            country: null,
            checkStatus: 'unchecked',
          },
        }),
      ),
    ).toBeNull();
  });
});
