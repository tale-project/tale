import '@testing-library/jest-dom/vitest';
import type { MutableRefObject } from 'react';
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { page } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import { toSettledItems } from '../lib/thread-view-core';
import type { ChatMessageItem, ChatMessageView } from '../types';
import {
  buildPendingShellItem,
  buildPendingUserItem,
  createPendingSend,
} from '../utils/pending-messages';
import { MessageThread } from './message-thread';

import '@/app/globals.css';

/**
 * The send-snap and the follow latch, laid out and scrolled by a real
 * browser. jsdom has no layout, no scroll geometry and no animation frames
 * worth the name, so only here can the machine in use-chat-scroll be seen
 * moving the transcript: a send glides the new user message to the top even
 * while a thread-open restore hold is live, a downward wheel (a trackpad's
 * momentum tail) never cancels that glide while an upward one does, the
 * scroll-to-bottom button keeps following a streaming reply, and a send never
 * remounts the rows it demotes to history.
 */

// Image-attachment parts resolve display URLs through a backend query; this
// harness renders without a provider, so the seam answers inert.
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

const VIEWPORT = { width: 900, height: 600 } as const;
const PARAGRAPH =
  'Rivers carry sediment toward the sea, and where the current slows the load settles into banks, bars and channels that split and rejoin. '.repeat(
    3,
  );
/** The saved position seeded for the restore test — mid-thread, so the
 * thread-open hold visibly pins the view away from the bottom. */
const RESTORED_TOP = 120;

/** Alternating user/assistant turns, several viewports tall. */
function conversation(turns: number): ChatMessageView[] {
  const rows: ChatMessageView[] = [];
  for (let index = 0; index < turns; index += 1) {
    rows.push({
      id: `u${index}`,
      role: 'user',
      sequence: index * 2 + 1,
      createdAt: index * 2 + 1,
      parts: [{ type: 'text', text: `Question ${index + 1}: ${PARAGRAPH}` }],
    });
    rows.push({
      id: `a${index}`,
      role: 'assistant',
      sequence: index * 2 + 2,
      createdAt: index * 2 + 2,
      parts: [{ type: 'text', text: `Answer ${index + 1}. ${PARAGRAPH}` }],
    });
  }
  return rows;
}

let sentCounter = 0;
/** The optimistic rows a send appends: the user bubble and the thinking shell. */
function pendingRows(text: string, threadId: string): ChatMessageItem[] {
  sentCounter += 1;
  const pending = createPendingSend({
    text,
    sentAt: 1_700_000_000_000 + sentCounter,
    threadId,
    baselineSequence: 1000,
  });
  return [buildPendingUserItem(pending), buildPendingShellItem(pending)];
}

/** One more settled reply — how the transcript grows in this harness. */
function extraReply(id: string, sequence: number): ChatMessageItem {
  return toSettledItems([
    {
      id,
      role: 'assistant',
      sequence,
      createdAt: sequence,
      parts: [{ type: 'text', text: `${id}. ${PARAGRAPH}` }],
    },
  ])[0]!;
}

function Harness({
  items,
  threadId,
  intentRef,
  isGenerating,
}: {
  items: readonly ChatMessageItem[];
  threadId: string;
  intentRef: MutableRefObject<boolean | 'smooth'>;
  isGenerating: boolean;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: VIEWPORT.width,
        height: VIEWPORT.height,
      }}
    >
      <MessageThread
        messages={items}
        threadId={threadId}
        threadRootId={threadId}
        isGenerating={isGenerating}
        scrollIntentRef={intentRef}
      />
    </div>
  );
}

const scroller = () => screen.getByRole('log');

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const settle = (ms: number) =>
  new Promise<void>((resolve) => {
    setTimeout(resolve, ms);
  });

/** Where the send-snap lands: the last user message's top at the content
 * padding inset, clamped into the scrollable range (use-chat-scroll's
 * `last-user-top` target). */
function snapTarget(log: HTMLElement): number {
  const content = log.firstElementChild as HTMLElement;
  const pad = parseFloat(getComputedStyle(content).paddingTop) || 16;
  const rows = log.querySelectorAll('li[data-message-role="user"]');
  const last = rows[rows.length - 1]!;
  const top =
    last.getBoundingClientRect().top -
    log.getBoundingClientRect().top +
    log.scrollTop;
  return Math.min(Math.max(top - pad, 0), log.scrollHeight - log.clientHeight);
}

const gapToBottom = (log: HTMLElement) =>
  log.scrollHeight - log.clientHeight - log.scrollTop;

beforeAll(() => {
  // Seeded BEFORE the first mount: the hook loads the persisted positions
  // once per module instance.
  window.sessionStorage.setItem(
    'tale_chat_scroll_positions',
    JSON.stringify({ 'thread-restore': RESTORED_TOP }),
  );
});

beforeEach(async () => {
  await page.viewport(1000, 720);
});

afterEach(() => {
  cleanup();
});

describe('MessageThread send-snap', () => {
  it('glides a message sent inside the thread-open restore window to the top', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-restore"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    // The remembered position is restored and held for the open window.
    expect(Math.round(log.scrollTop)).toBe(RESTORED_TOP);

    // Send while that 2 s position hold is still live: the send must win.
    intentRef.current = 'smooth';
    rerender(
      <Harness
        items={[
          ...items,
          ...pendingRows('A follow-up question.', 'thread-restore'),
        ]}
        threadId="thread-restore"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await expect
      .poll(() => Math.abs(log.scrollTop - snapTarget(log)), {
        timeout: 2000,
        interval: 50,
      })
      .toBeLessThanOrEqual(2);
    expect(intentRef.current).toBe(false);
  });

  it('lets a downward wheel (a trackpad momentum tail) through mid-glide', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-wheel-down"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    log.scrollTop = log.scrollHeight;
    await nextFrame();

    intentRef.current = 'smooth';
    rerender(
      <Harness
        items={[
          ...items,
          ...pendingRows('First follow-up.', 'thread-wheel-down'),
        ]}
        threadId="thread-wheel-down"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await settle(120); // the glide is in flight
    const midway = log.scrollTop;
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: 3, bubbles: true }));

    await expect
      .poll(() => Math.abs(log.scrollTop - snapTarget(log)), {
        timeout: 2000,
        interval: 50,
      })
      .toBeLessThanOrEqual(2);
    expect(log.scrollTop).toBeGreaterThan(midway);
  });

  it('stops the glide where an upward wheel takes over', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-wheel-up"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    log.scrollTop = log.scrollHeight;
    await nextFrame();

    intentRef.current = 'smooth';
    rerender(
      <Harness
        items={[
          ...items,
          ...pendingRows('Second follow-up.', 'thread-wheel-up'),
        ]}
        threadId="thread-wheel-up"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await settle(120);
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    const stopped = log.scrollTop;
    await settle(600);

    expect(Math.abs(log.scrollTop - stopped)).toBeLessThanOrEqual(1);
    expect(snapTarget(log) - log.scrollTop).toBeGreaterThan(40);
    expect(intentRef.current).toBe(false);
  });

  it('keeps the previous turn mounted at its rendered height when a send demotes it to history', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-identity"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    await nextFrame();
    const rows = screen.getAllByTestId('chat-message');
    const previousUser = rows[rows.length - 2]!;
    const previousReply = rows[rows.length - 1]!;
    const replyHeight = previousReply.getBoundingClientRect().height;

    intentRef.current = 'smooth';
    rerender(
      <Harness
        items={[...items, ...pendingRows('Another one.', 'thread-identity')]}
        threadId="thread-identity"
        intentRef={intentRef}
        isGenerating
      />,
    );

    // Same nodes: the rows changed region, not parent.
    expect(previousUser.isConnected).toBe(true);
    expect(previousReply.isConnected).toBe(true);
    // The demoted reply now rasterizes lazily — at its remembered height on
    // the very first layout, never at the 200px placeholder.
    expect(previousReply).toHaveClass('[content-visibility:auto]');
    expect(previousReply.getBoundingClientRect().height).toBeCloseTo(
      replyHeight,
      0,
    );
    await nextFrame();
    expect(previousReply.getBoundingClientRect().height).toBeCloseTo(
      replyHeight,
      0,
    );
  });
});

describe('MessageThread scroll-to-bottom while streaming', () => {
  it('follows the growing reply after the button, until an upward wheel', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-follow"
        intentRef={intentRef}
        isGenerating
      />,
    );
    const log = scroller();
    await nextFrame();
    // The user wheels up to read the top while the reply streams below (the
    // wheel is what releases the thread-open hold, as it does for a person).
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    const button = await screen.findByRole('button', {
      name: 'Scroll to bottom',
    });
    button.click();
    await expect
      .poll(() => gapToBottom(log), { timeout: 1500, interval: 50 })
      .toBeLessThanOrEqual(1);

    // The reply grows: the follow latch re-lands the bottom.
    const grown = [...items, extraReply('more-1', 101)];
    rerender(
      <Harness
        items={grown}
        threadId="thread-follow"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await expect
      .poll(() => gapToBottom(log), { timeout: 1500, interval: 50 })
      .toBeLessThanOrEqual(1);
    // The button state flushes on React's next tick after the observer tick.
    await expect
      .poll(() => screen.queryByRole('button', { name: 'Scroll to bottom' }), {
        timeout: 1000,
        interval: 50,
      })
      .toBeNull();

    // An upward wheel ends the follow; further growth stays below the fold.
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    rerender(
      <Harness
        items={[...grown, extraReply('more-2', 102)]}
        threadId="thread-follow"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await nextFrame();
    await nextFrame();
    expect(gapToBottom(log)).toBeGreaterThan(40);
  });

  it('keeps following once the generation flag drops (the reveal outlives it)', async () => {
    // The server settles before the client-side reveal finishes drawing the
    // reply, so `isGenerating` is already false while the text still grows —
    // the latch must not read it.
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(6));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-follow-drain"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    const button = await screen.findByRole('button', {
      name: 'Scroll to bottom',
    });
    button.click();
    await expect
      .poll(() => gapToBottom(log), { timeout: 1500, interval: 50 })
      .toBeLessThanOrEqual(1);

    rerender(
      <Harness
        items={[...items, extraReply('drain-1', 101)]}
        threadId="thread-follow-drain"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    await expect
      .poll(() => gapToBottom(log), { timeout: 1500, interval: 50 })
      .toBeLessThanOrEqual(1);
  });
});
