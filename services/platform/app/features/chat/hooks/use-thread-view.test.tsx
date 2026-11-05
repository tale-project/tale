// @vitest-environment jsdom
/**
 * The view's live lane — the thread's `/stream` — answers the chat's owner
 * alone (CHAT-R2). A view that follows no live turn, a project reader's,
 * opens no lane and leaves the owner's running reply out until a later read
 * brings it settled; the owner's view follows the turn as before.
 */
import { renderHook } from '@testing-library/react';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { useChatMessages } from '../data/chat-backend';
import type { ChatMessageView } from '../types';
import { useThreadView } from './use-thread-view';

vi.mock('../data/chat-backend', async (importOriginal) => {
  const original =
    await importOriginal<typeof import('../data/chat-backend')>();
  return { ...original, useChatMessages: vi.fn() };
});

/** Records the lanes a render opens; nothing ever arrives on them. */
class FakeEventSource {
  static readonly opened: string[] = [];
  constructor(url: string) {
    FakeEventSource.opened.push(url);
  }
  addEventListener() {}
  removeEventListener() {}
  close() {}
}

const ROWS: readonly ChatMessageView[] = [
  {
    id: 'u1',
    role: 'user',
    parts: [{ type: 'text', text: 'Which files ship?' }],
    sequence: 1,
    status: 'complete',
    createdAt: 1,
  },
  // The owner's turn is still writing its reply.
  {
    id: 'a2',
    role: 'assistant',
    parts: [],
    sequence: 2,
    status: 'pending',
    createdAt: 2,
  },
];

beforeAll(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterAll(() => {
  vi.unstubAllGlobals();
});
beforeEach(() => {
  FakeEventSource.opened.length = 0;
  vi.mocked(useChatMessages).mockReturnValue({ status: 'ready', data: ROWS });
});

describe('useThreadView without the live lane [CHAT-R2]', () => {
  it('opens no lane and shows the conversation without the running reply', () => {
    const { result } = renderHook(() =>
      useThreadView('org-1', 'thread-1', null, undefined, { live: false }),
    );

    expect(FakeEventSource.opened).toEqual([]);
    expect(result.current.items.map((item) => item.id)).toEqual(['u1']);
  });

  it('follows the turn on the lane in the owner’s view', () => {
    const { result } = renderHook(() =>
      useThreadView('org-1', 'thread-1', null, undefined),
    );

    expect(FakeEventSource.opened).toEqual([
      expect.stringContaining('/chat/threads/thread-1/stream'),
    ]);
    expect(result.current.items.map((item) => item.id)).toEqual(['u1', 'a2']);
  });
});
