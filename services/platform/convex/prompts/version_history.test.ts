import { describe, expect, it, vi } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import { MAX_PROMPT_VERSION_HISTORY } from './constants';
import {
  buildNextVersionEntry,
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

function makePromptDoc(
  overrides: Partial<Doc<'promptTemplates'>> = {},
): Doc<'promptTemplates'> {
  return {
    _id: 'prompt_1' as Doc<'promptTemplates'>['_id'],
    _creationTime: 10_000,
    organizationId: 'org_1',
    createdBy: 'user_a',
    title: 'Test prompt',
    content: 'current content',
    scope: 'personal',
    usageCount: 0,
    isPublished: true,
    version: 1,
    versionHistory: [
      {
        version: 1,
        content: 'current content',
        publishedAt: 10_000,
        publishedBy: 'user_a',
      },
    ],
    ...overrides,
  } as Doc<'promptTemplates'>;
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

describe('buildNextVersionEntry', () => {
  it('increments version and prepends entry on a versioned prompt', () => {
    const existing = makePromptDoc({
      version: 3,
      content: 'old',
      versionHistory: [makeEntry(3, 'old'), makeEntry(2), makeEntry(1)],
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'new',
      publishedBy: 'user_b',
    });

    expect(built.newVersion).toBe(4);
    expect(built.entry.version).toBe(4);
    expect(built.entry.content).toBe('new');
    expect(built.entry.publishedBy).toBe('user_b');
    expect(built.nextHistory.map((e) => e.version)).toEqual([4, 3, 2, 1]);
    // entries from existing history are not mutated
    expect(built.nextHistory[1].content).toBe('old');
  });

  it('JIT-seeds a legacy prompt: original content becomes v1, edit becomes v2', () => {
    // Legacy = `version` undefined and no versionHistory.
    const existing = makePromptDoc({
      version: undefined,
      versionHistory: undefined,
      content: 'original',
      _creationTime: 42,
      createdBy: 'user_legacy',
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'edited',
      publishedBy: 'user_editor',
    });

    expect(built.newVersion).toBe(2);
    expect(built.entry.version).toBe(2);
    expect(built.entry.content).toBe('edited');
    expect(built.entry.publishedBy).toBe('user_editor');
    expect(built.nextHistory).toHaveLength(2);
    // v2 (newest) is first; v1 (seeded original) is second.
    expect(built.nextHistory[0].version).toBe(2);
    expect(built.nextHistory[1]).toMatchObject({
      version: 1,
      content: 'original',
      publishedAt: 42,
      publishedBy: 'user_legacy',
    });
  });

  it('does not seed when versionHistory is empty but version is defined', () => {
    // Defensive: if version is set but history is empty, treat as non-legacy
    // and just append. Should not happen in practice but the helper must not
    // double-seed.
    const existing = makePromptDoc({
      version: 5,
      versionHistory: [],
      content: 'current',
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'next',
      publishedBy: 'user_b',
    });

    expect(built.newVersion).toBe(6);
    expect(built.nextHistory).toHaveLength(1);
    expect(built.nextHistory[0].version).toBe(6);
  });
});
