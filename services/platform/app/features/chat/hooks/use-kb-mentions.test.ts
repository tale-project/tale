import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import {
  detectMentionTrigger,
  kbMentionKey,
  MAX_KB_MENTIONS,
  useKbMentions,
  type KbMention,
} from './use-kb-mentions';

function mention(n: number): KbMention {
  return {
    kind: 'document',
    documentId: `doc_${n}` as Id<'documents'>,
    fileId: `file_${n}` as Id<'_storage'>,
    title: `Document ${n}`,
    fileType: 'application/pdf',
    fileSize: 100 + n,
  };
}

function folderMention(n: number): KbMention {
  return {
    kind: 'folder',
    folderId: `folder_${n}` as Id<'folders'>,
    title: `Folder ${n}`,
  };
}

describe('detectMentionTrigger', () => {
  it('triggers on a leading @', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({
      query: '',
      start: 0,
      end: 1,
    });
  });

  it('triggers on @ after whitespace and captures the query', () => {
    expect(detectMentionTrigger('summarize @rep', 14)).toEqual({
      query: 'rep',
      start: 10,
      end: 14,
    });
  });

  it('uses the text BEFORE the caret only', () => {
    // Caret right after '@re' even though more text follows.
    expect(detectMentionTrigger('see @re and more', 7)).toEqual({
      query: 're',
      start: 4,
      end: 7,
    });
  });

  it('does not trigger mid-word (email addresses)', () => {
    expect(detectMentionTrigger('mail me at ym@tale.dev', 22)).toBeNull();
  });

  it('does not trigger once whitespace follows the query', () => {
    expect(detectMentionTrigger('@report done', 12)).toBeNull();
  });

  it('does not trigger without an @', () => {
    expect(detectMentionTrigger('plain message', 13)).toBeNull();
  });
});

describe('useKbMentions', () => {
  it('adds mentions, dedupes by documentId, and enforces the cap', () => {
    const { result } = renderHook(() => useKbMentions());

    act(() => {
      expect(result.current.addMention(mention(1))).toBe(true);
      // Duplicate add is a no-op but reports success (already pinned).
      expect(result.current.addMention(mention(1))).toBe(true);
    });
    expect(result.current.mentions).toHaveLength(1);

    act(() => {
      for (let i = 2; i <= MAX_KB_MENTIONS; i++) {
        expect(result.current.addMention(mention(i))).toBe(true);
      }
      // One past the cap is rejected.
      expect(result.current.addMention(mention(MAX_KB_MENTIONS + 1))).toBe(
        false,
      );
    });
    expect(result.current.mentions).toHaveLength(MAX_KB_MENTIONS);
  });

  it('removes a mention by its key', () => {
    const { result } = renderHook(() => useKbMentions());
    act(() => {
      result.current.addMention(mention(1));
      result.current.addMention(mention(2));
    });
    act(() => {
      result.current.removeMention('doc:doc_1');
    });
    expect(result.current.mentions.map((m) => kbMentionKey(m))).toEqual([
      'doc:doc_2',
    ]);
  });

  it('folder pins share the cap and dedupe by folder key', () => {
    const { result } = renderHook(() => useKbMentions());
    act(() => {
      expect(result.current.addMention(folderMention(1))).toBe(true);
      // Duplicate folder add is a no-op but reports success.
      expect(result.current.addMention(folderMention(1))).toBe(true);
      expect(result.current.addMention(mention(1))).toBe(true);
    });
    expect(result.current.mentions).toHaveLength(2);

    act(() => {
      for (let i = 2; i < MAX_KB_MENTIONS; i++) {
        expect(result.current.addMention(mention(i))).toBe(true);
      }
      // Cap counts documents AND folders together.
      expect(result.current.addMention(folderMention(2))).toBe(false);
    });
    expect(result.current.mentions).toHaveLength(MAX_KB_MENTIONS);

    act(() => {
      result.current.removeMention('folder:folder_1');
    });
    expect(result.current.mentions.some((m) => m.kind === 'folder')).toBe(
      false,
    );
  });

  it('clearMentions returns the snapshot and restoreMentions brings it back', () => {
    const { result } = renderHook(() => useKbMentions());
    act(() => {
      result.current.addMention(mention(1));
      result.current.addMention(mention(2));
    });

    let snapshot: KbMention[] = [];
    act(() => {
      snapshot = result.current.clearMentions();
    });
    expect(snapshot).toHaveLength(2);
    expect(result.current.mentions).toHaveLength(0);

    act(() => {
      result.current.restoreMentions(snapshot);
    });
    expect(result.current.mentions).toHaveLength(2);
  });
});
