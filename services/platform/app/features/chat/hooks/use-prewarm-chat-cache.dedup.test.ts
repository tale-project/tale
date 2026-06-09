import { describe, expect, it } from 'vitest';

import { isPrewarmDeduped, prewarmKey } from './use-prewarm-chat-cache';

const TTL = 4 * 60 * 1000;

describe('prewarmKey', () => {
  it('is per (thread, agent, project)', () => {
    expect(prewarmKey('t1', 'a1', 'p1')).toBe('t1::a1::p1');
    expect(prewarmKey('t1', 'a1')).toBe('t1::a1::');
    expect(prewarmKey('t1', 'a1', 'p1')).not.toBe(prewarmKey('t1', 'a1', 'p2'));
  });
});

describe('isPrewarmDeduped', () => {
  const key = prewarmKey('t1', 'a1');

  it('fires (not deduped) when there is no prior prewarm', () => {
    expect(isPrewarmDeduped(null, key, 1000, TTL)).toBe(false);
  });

  it('dedups a repeat of the same key within the TTL', () => {
    expect(isPrewarmDeduped({ key, at: 0 }, key, TTL - 1, TTL)).toBe(true);
  });

  it('fires again once the TTL has elapsed', () => {
    expect(isPrewarmDeduped({ key, at: 0 }, key, TTL, TTL)).toBe(false);
    expect(isPrewarmDeduped({ key, at: 0 }, key, TTL + 1, TTL)).toBe(false);
  });

  it('does not dedup a different key (different agent/thread/project)', () => {
    const other = prewarmKey('t1', 'a2');
    expect(isPrewarmDeduped({ key, at: 0 }, other, 10, TTL)).toBe(false);
  });
});
