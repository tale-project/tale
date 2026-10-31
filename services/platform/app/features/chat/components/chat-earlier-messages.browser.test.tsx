import '@testing-library/jest-dom/vitest';
import { useSyncExternalStore, type MutableRefObject } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page, userEvent } from 'vitest/browser';

import { act, cleanup, render, screen } from '@/tests/utils/render';

import { toSettledItems } from '../lib/thread-view-core';
import type { ChatMessageItem, ChatMessageView } from '../types';
import { useChatEarlierMessages } from './chat-earlier-messages';
import { MessageThread } from './message-thread';

import '@/app/globals.css';

/**
 * "Show earlier messages", laid out and scrolled by a real browser: the row
 * being read holds still while the older page lands above it, the rows the
 * reader sees are awake in the first frame that shows them, and the button
 * keeps the keyboard's focus through the read. jsdom has no layout, so only
 * here can the anchor be seen against the transcript's own scroll machine
 * and row waker.
 */

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

/** The thread's loaded rows and its way back, changed together as the real
 * page read changes them: the busy state ends with the render that shows the
 * older rows. */
const thread = vi.hoisted(() => {
  type State = {
    items: readonly unknown[];
    hasMore: boolean;
    loading: boolean;
  };
  let state: State = { items: [], hasMore: true, loading: false };
  const listeners = new Set<() => void>();
  return {
    reads: 0,
    land: (): void => {},
    get: () => state,
    set: (next: Partial<State>) => {
      state = { ...state, ...next };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
});

vi.mock('../data/chat-backend', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../data/chat-backend')>()),
  useEarlierChatMessages: () => {
    const { hasMore, loading } = useSyncExternalStore(
      thread.subscribe,
      thread.get,
    );
    return {
      hasMore,
      loading,
      loadEarlier: () => {
        thread.reads += 1;
        thread.set({ loading: true });
        return new Promise<void>((resolve) => {
          thread.land = resolve;
        });
      },
    };
  },
}));

const PARAGRAPH =
  'Rivers carry sediment toward the sea, and where the current slows the load settles into banks, bars and channels that split and rejoin. '.repeat(
    3,
  );

function conversation(turns: number): ChatMessageView[] {
  return Array.from({ length: turns }, (_turn, index) => [
    {
      id: `u${index}`,
      role: 'user' as const,
      sequence: index * 2 + 1,
      createdAt: index * 2 + 1,
      parts: [
        { type: 'text' as const, text: `Question ${index + 1}: ${PARAGRAPH}` },
      ],
    },
    {
      id: `a${index}`,
      role: 'assistant' as const,
      sequence: index * 2 + 2,
      createdAt: index * 2 + 2,
      parts: [
        { type: 'text' as const, text: `Answer ${index + 1}. ${PARAGRAPH}` },
      ],
    },
  ]).flat();
}

/** 64 rows: the thread opens on its newest 24, a read brings 32 more. */
const ALL = toSettledItems(conversation(32));
const OPENED = 40;
const READ_TO = 8;

function Harness({ threadId }: { threadId: string }) {
  const { items } = useSyncExternalStore(thread.subscribe, thread.get);
  const messages = items as readonly ChatMessageItem[];
  const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
  const { historyRef, earlier } = useChatEarlierMessages(
    'org-1',
    threadId,
    messages[0]?.id,
  );
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 900,
        height: 600,
      }}
    >
      <MessageThread
        messages={messages}
        threadId={threadId}
        threadRootId={threadId}
        isGenerating={false}
        scrollIntentRef={intentRef}
        earlier={earlier}
        historyRef={historyRef}
      />
    </div>
  );
}

const scroller = () => screen.getByRole('log');
const firstFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });
const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
const settle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });
const rowsOf = (log: HTMLElement) =>
  Array.from(
    log.querySelectorAll<HTMLElement>('li[data-testid="chat-message"]'),
  );
const isDormant = (row: HTMLElement) => row.hasAttribute('data-dormant');
function rowsInView(log: HTMLElement): HTMLElement[] {
  const view = log.getBoundingClientRect();
  return rowsOf(log).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > view.top && rect.top < view.bottom;
  });
}

beforeEach(async () => {
  await page.viewport(1000, 720);
  thread.reads = 0;
  thread.set({ items: ALL.slice(OPENED), hasMore: true, loading: false });
});

afterEach(() => {
  cleanup();
});

describe('ChatEarlierMessages in a real browser', () => {
  it.each([
    { opened: 'at its newest row', threadId: 'thread-earlier-newest' },
    { opened: 'at a remembered top', threadId: 'thread-earlier-restored' },
  ])(
    'holds the row being read still while the older page lands, opened $opened',
    async ({ threadId }) => {
      // A remembered position starts the transcript's thread-open hold: the
      // read lands inside it, and the hold must stand down for the anchor.
      window.sessionStorage.setItem(
        'tale_chat_scroll_positions',
        JSON.stringify({ 'thread-earlier-restored': 0 }),
      );
      render(<Harness threadId={threadId} />);
      const log = scroller();
      await nextFrame();
      if (threadId === 'thread-earlier-newest') {
        log.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -120, bubbles: true }),
        );
        log.scrollTop = 0;
        log.dispatchEvent(new Event('scroll'));
      }
      await settle(100);
      expect(log.scrollTop).toBe(0);

      const earlier = screen.getByRole('button', {
        name: 'Show earlier messages',
      });
      earlier.focus();
      const read = rowsOf(log)[0]!;
      expect(rowsInView(log)[0]).toBe(read);
      const top = read.getBoundingClientRect().top;

      await userEvent.keyboard('{Enter}');
      await expect.poll(() => earlier.getAttribute('aria-busy')).toBe('true');
      expect(earlier).toHaveFocus();
      expect(thread.reads).toBe(1);

      act(() => {
        thread.set({ items: ALL.slice(READ_TO), loading: false });
        thread.land();
      });
      await firstFrame();
      const drift = () => Math.abs(read.getBoundingClientRect().top - top);
      expect(drift()).toBeLessThanOrEqual(1);
      // The rows the reader sees woke before the frame that shows them.
      expect(rowsInView(log).some(isDormant)).toBe(false);

      await settle(700);
      expect(drift()).toBeLessThanOrEqual(1);
      expect(rowsOf(log)).toHaveLength(ALL.length - READ_TO);
      expect(rowsOf(log)[OPENED - READ_TO]).toBe(read);
      expect(earlier).toHaveFocus();
      expect(earlier).not.toHaveAttribute('aria-busy');
      expect(isDormant(rowsOf(log)[OPENED - READ_TO - 1]!)).toBe(false);
    },
  );
});
