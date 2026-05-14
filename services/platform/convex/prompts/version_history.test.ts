import { describe, expect, it } from 'vitest';

import type { Doc } from '../_generated/dataModel';
import { MAX_PROMPT_VERSION_HISTORY } from './constants';
import {
  buildNextVersionEntry,
  metadataDiffers,
  prependVersionEntry,
  resolveRestoreTarget,
  synthesizeLegacyV1Entry,
  type PromptVersionMetadata,
  type VersionHistoryEntry,
} from './version_history';

function makeEntry(
  version: number,
  content = `v${version}`,
  overrides: Partial<VersionHistoryEntry> = {},
): VersionHistoryEntry {
  return {
    version,
    content,
    publishedAt: version * 1_000,
    publishedBy: 'user_a',
    title: 'Test prompt',
    scope: 'personal',
    ...overrides,
  };
}

function makeMetadata(
  overrides: Partial<PromptVersionMetadata> = {},
): PromptVersionMetadata {
  return {
    title: 'Test prompt',
    scope: 'personal',
    ...overrides,
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
    version: 1,
    versionHistory: [
      {
        version: 1,
        content: 'current content',
        publishedAt: 10_000,
        publishedBy: 'user_a',
        title: 'Test prompt',
        scope: 'personal',
      },
    ],
    ...overrides,
  } as Doc<'promptTemplates'>;
}

describe('prependVersionEntry', () => {
  it('prepends the entry to an empty history', () => {
    const { history, droppedVersions } = prependVersionEntry(
      undefined,
      makeEntry(1),
    );
    expect(history).toHaveLength(1);
    expect(history[0].version).toBe(1);
    expect(droppedVersions).toEqual([]);
  });

  it('prepends in front of existing entries (newest-first order)', () => {
    const { history, droppedVersions } = prependVersionEntry(
      [makeEntry(1)],
      makeEntry(2),
    );
    expect(history.map((e) => e.version)).toEqual([2, 1]);
    expect(droppedVersions).toEqual([]);
  });

  it('caps the array at MAX_PROMPT_VERSION_HISTORY and drops the oldest', () => {
    const existing = Array.from(
      { length: MAX_PROMPT_VERSION_HISTORY },
      (_, i) => makeEntry(MAX_PROMPT_VERSION_HISTORY - i),
    );
    const newest = makeEntry(MAX_PROMPT_VERSION_HISTORY + 1);
    const { history, droppedVersions } = prependVersionEntry(
      existing,
      newest,
      'prompt_1',
    );
    expect(history).toHaveLength(MAX_PROMPT_VERSION_HISTORY);
    expect(history[0].version).toBe(MAX_PROMPT_VERSION_HISTORY + 1);
    expect(history.find((e) => e.version === 1)).toBeUndefined();
    expect(droppedVersions).toEqual([1]);
  });
});

describe('buildNextVersionEntry', () => {
  it('increments version and prepends an entry with metadata snapshot', () => {
    const existing = makePromptDoc({
      version: 3,
      content: 'old',
      title: 'Old title',
      versionHistory: [
        makeEntry(3, 'old', { title: 'Old title' }),
        makeEntry(2),
        makeEntry(1),
      ],
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'new',
      publishedBy: 'user_b',
      metadata: makeMetadata({ title: 'New title', category: 'general' }),
    });

    expect(built.newVersion).toBe(4);
    expect(built.nextHistory[0]).toMatchObject({
      version: 4,
      content: 'new',
      publishedBy: 'user_b',
      title: 'New title',
      category: 'general',
      scope: 'personal',
    });
    expect(built.nextHistory.map((e) => e.version)).toEqual([4, 3, 2, 1]);
    expect(built.nextHistory[1].content).toBe('old');
    expect(built.droppedVersions).toEqual([]);
  });

  it('propagates droppedVersions when prepending past the FIFO cap', () => {
    const fullHistory = Array.from(
      { length: MAX_PROMPT_VERSION_HISTORY },
      (_, i) => makeEntry(MAX_PROMPT_VERSION_HISTORY - i),
    );
    const existing = makePromptDoc({
      version: MAX_PROMPT_VERSION_HISTORY,
      content: `v${MAX_PROMPT_VERSION_HISTORY}`,
      versionHistory: fullHistory,
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'next',
      publishedBy: 'user_b',
      metadata: makeMetadata(),
    });

    expect(built.newVersion).toBe(MAX_PROMPT_VERSION_HISTORY + 1);
    expect(built.nextHistory).toHaveLength(MAX_PROMPT_VERSION_HISTORY);
    expect(built.droppedVersions).toEqual([1]);
  });

  it('JIT-seeds a legacy prompt with both content AND metadata', () => {
    const existing = makePromptDoc({
      version: undefined,
      versionHistory: undefined,
      content: 'original',
      title: 'Legacy title',
      category: 'legacy-cat',
      tags: ['legacy'],
      _creationTime: 42,
      createdBy: 'user_legacy',
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'edited',
      publishedBy: 'user_editor',
      metadata: makeMetadata({ title: 'Edited title' }),
    });

    expect(built.newVersion).toBe(2);
    expect(built.nextHistory[0]).toMatchObject({
      version: 2,
      content: 'edited',
      publishedBy: 'user_editor',
      title: 'Edited title',
    });
    expect(built.nextHistory).toHaveLength(2);
    expect(built.nextHistory[1]).toMatchObject({
      version: 1,
      content: 'original',
      publishedAt: 42,
      publishedBy: 'user_legacy',
      title: 'Legacy title',
      category: 'legacy-cat',
      tags: ['legacy'],
    });
  });

  it('does not seed when versionHistory is empty but version is defined', () => {
    const existing = makePromptDoc({
      version: 5,
      versionHistory: [],
      content: 'current',
    });

    const built = buildNextVersionEntry({
      existing,
      content: 'next',
      publishedBy: 'user_b',
      metadata: makeMetadata(),
    });

    expect(built.newVersion).toBe(6);
    expect(built.nextHistory).toHaveLength(1);
    expect(built.nextHistory[0].version).toBe(6);
  });
});

describe('resolveRestoreTarget', () => {
  it('returns the matching versionHistory entry for a versioned row', () => {
    const existing = makePromptDoc({
      version: 3,
      versionHistory: [
        makeEntry(3, 'three'),
        makeEntry(2, 'two'),
        makeEntry(1, 'one'),
      ],
    });
    expect(resolveRestoreTarget(existing, 2)?.content).toBe('two');
  });

  it('synthesizes v1 from current row state for a legacy row', () => {
    const existing = makePromptDoc({
      version: undefined,
      versionHistory: undefined,
      content: 'legacy content',
      title: 'Legacy title',
      _creationTime: 1_234,
      createdBy: 'user_legacy',
    });
    const target = resolveRestoreTarget(existing, 1);
    expect(target).toMatchObject({
      version: 1,
      content: 'legacy content',
      title: 'Legacy title',
      publishedAt: 1_234,
      publishedBy: 'user_legacy',
    });
  });

  it('returns undefined for a non-existent version on a versioned row', () => {
    const existing = makePromptDoc({
      version: 3,
      versionHistory: [makeEntry(3), makeEntry(2), makeEntry(1)],
    });
    expect(resolveRestoreTarget(existing, 99)).toBeUndefined();
  });

  it('returns undefined for v2+ on a legacy row (only v1 can be synthesized)', () => {
    const existing = makePromptDoc({
      version: undefined,
      versionHistory: undefined,
    });
    expect(resolveRestoreTarget(existing, 2)).toBeUndefined();
  });
});

describe('synthesizeLegacyV1Entry', () => {
  it('captures the row’s current state as a v1 entry', () => {
    const existing = makePromptDoc({
      version: undefined,
      versionHistory: undefined,
      content: 'baseline',
      title: 'Legacy title',
      description: 'desc',
      category: 'general',
      tags: ['a', 'b'],
      scope: 'team',
      teamId: 'team_42',
      _creationTime: 7_777,
      createdBy: 'user_legacy',
    });
    expect(synthesizeLegacyV1Entry(existing)).toEqual({
      version: 1,
      content: 'baseline',
      publishedAt: 7_777,
      publishedBy: 'user_legacy',
      title: 'Legacy title',
      description: 'desc',
      category: 'general',
      tags: ['a', 'b'],
      scope: 'team',
      teamId: 'team_42',
    });
  });
});

describe('metadataDiffers', () => {
  const base = {
    title: 'a',
    description: 'd',
    category: 'c',
    tags: ['x', 'y'],
    scope: 'personal' as const,
    teamId: undefined,
  };

  it('returns false when every field matches', () => {
    expect(metadataDiffers(base, { ...base })).toBe(false);
  });

  it('returns true on title change', () => {
    expect(metadataDiffers(base, { ...base, title: 'b' })).toBe(true);
  });

  it('returns true on tag reorder (order-sensitive by design)', () => {
    expect(metadataDiffers(base, { ...base, tags: ['y', 'x'] })).toBe(true);
  });

  it('returns true on scope change', () => {
    expect(
      metadataDiffers(base, { ...base, scope: 'team', teamId: 't1' }),
    ).toBe(true);
  });

  it('treats missing optional vs explicit-undefined as equal', () => {
    expect(
      metadataDiffers(
        { ...base, description: undefined },
        { ...base, description: undefined },
      ),
    ).toBe(false);
  });
});
