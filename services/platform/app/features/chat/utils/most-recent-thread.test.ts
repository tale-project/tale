import { describe, expect, it } from 'vitest';

import type { ChatThreadSummary } from '../types';
import { pickMostRecentThread } from './most-recent-thread';

function thread(
  partial: Pick<ChatThreadSummary, 'id' | 'createdAt'> &
    Partial<ChatThreadSummary>,
): ChatThreadSummary {
  return {
    kind: 'direct',
    archived: false,
    generating: false,
    updatedAt: partial.updatedAt ?? partial.createdAt,
    ...partial,
  };
}

describe('pickMostRecentThread', () => {
  it('returns undefined for an empty list', () => {
    expect(pickMostRecentThread([])).toBeUndefined();
  });

  it('prefers the newest lastReplyAt over pin order', () => {
    const olderPinned = thread({
      id: 'pinned',
      createdAt: 100,
      updatedAt: 200,
      lastReplyAt: 200,
      pinnedAt: 999,
    });
    const newer = thread({
      id: 'recent',
      createdAt: 100,
      updatedAt: 500,
      lastReplyAt: 500,
    });
    // Pinned-first list order (what listThreads returns).
    expect(pickMostRecentThread([olderPinned, newer])?.id).toBe('recent');
  });

  it('falls back to createdAt when no reply has landed', () => {
    const a = thread({ id: 'a', createdAt: 10, updatedAt: 10 });
    const b = thread({ id: 'b', createdAt: 30, updatedAt: 30 });
    expect(pickMostRecentThread([a, b])?.id).toBe('b');
  });
});
