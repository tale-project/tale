import { describe, expect, it, vi } from 'vitest';

import { MAX_PROMPT_VERSION_HISTORY } from './constants';
import {
  prependVersionEntry,
  type VersionHistoryEntry,
} from './version_history';

function makeEntry(
  version: number,
  content = `v${version}`,
): VersionHistoryEntry {
  return {
    version,
    content,
    publishedAt: version * 1_000,
    publishedBy: 'user_a',
  };
}

describe('prependVersionEntry', () => {
  it('prepends the entry to an empty history', () => {
    const next = prependVersionEntry(undefined, makeEntry(1));
    expect(next).toHaveLength(1);
    expect(next[0].version).toBe(1);
  });

  it('prepends in front of existing entries (newest-first order)', () => {
    const next = prependVersionEntry([makeEntry(1)], makeEntry(2));
    expect(next.map((e) => e.version)).toEqual([2, 1]);
  });

  it('preserves publishNote on the prepended entry', () => {
    const entry = { ...makeEntry(2), publishNote: 'second cut' };
    const next = prependVersionEntry([makeEntry(1)], entry);
    expect(next[0].publishNote).toBe('second cut');
  });

  it('caps the array at MAX_PROMPT_VERSION_HISTORY and drops the oldest', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    // newest-first history of MAX entries (versions MAX..1)
    const existing = Array.from(
      { length: MAX_PROMPT_VERSION_HISTORY },
      (_, i) => makeEntry(MAX_PROMPT_VERSION_HISTORY - i),
    );
    const newest = makeEntry(MAX_PROMPT_VERSION_HISTORY + 1);
    const next = prependVersionEntry(existing, newest, 'prompt_1');
    expect(next).toHaveLength(MAX_PROMPT_VERSION_HISTORY);
    expect(next[0].version).toBe(MAX_PROMPT_VERSION_HISTORY + 1);
    // The oldest entry (version 1) should have been dropped.
    expect(next.find((e) => e.version === 1)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    warn.mockRestore();
  });
});
