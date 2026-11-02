import { describe, expect, it } from 'vitest';

import { reconnectDelay, streamUrl } from './stream-url';

describe('streamUrl', () => {
  it('connects to the host of the page', () => {
    expect(streamUrl(7, { protocol: 'http:', host: '127.0.0.1:3004' })).toBe(
      'ws://127.0.0.1:3004/api/sessions/7/stream',
    );
  });

  it('is secure when the page is', () => {
    expect(streamUrl(12, { protocol: 'https:', host: 'sessions.test' })).toBe(
      'wss://sessions.test/api/sessions/12/stream',
    );
  });

  it('follows the location of this page by default', () => {
    expect(streamUrl(3)).toBe(
      `ws://${window.location.host}/api/sessions/3/stream`,
    );
  });
});

describe('reconnectDelay', () => {
  it('doubles from a second', () => {
    expect([0, 1, 2, 3].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000]);
  });

  it('never waits longer than ten seconds', () => {
    expect([4, 5, 10, 60].map(reconnectDelay)).toEqual([
      10_000, 10_000, 10_000, 10_000,
    ]);
  });
});
