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
import { page, userEvent } from 'vitest/browser';

import { cleanup, render, screen } from '@/tests/utils/render';

import {
  useActivePlaybackWriter,
  VoiceOutputProvider,
} from '../hooks/voice-output-context';
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

// Observe the player's mounted lifetime while the real provider owns the
// playback channel, without making network audio requests in a layout test.
const voicePlayer = vi.hoisted(() => ({ unmounted: vi.fn() }));
vi.mock('./voice-output-indicator', async () => {
  const { useEffect } = await import('react');
  return {
    VoiceOutputIndicator: function VoiceOutputIndicator({
      messageId,
    }: {
      messageId: string;
    }) {
      useEffect(() => () => voicePlayer.unmounted(messageId), [messageId]);
      return <div data-testid={`voice-player-${messageId}`} />;
    },
  };
});

function PlaybackControls() {
  const playback = useActivePlaybackWriter();
  return (
    <div>
      <button onClick={() => playback.set({ messageId: 'a0', chunkIndex: 0 })}>
        Start older playback
      </button>
      <button
        onClick={() => playback.set({ messageId: 'a0', chunkIndex: null })}
      >
        Wait for the next voice chunk
      </button>
      <button onClick={() => playback.clearIfOwner('a0')}>
        Stop older playback
      </button>
    </div>
  );
}

const VIEWPORT = { width: 900, height: 600 } as const;
const PARAGRAPH =
  'Rivers carry sediment toward the sea, and where the current slows the load settles into banks, bars and channels that split and rejoin. '.repeat(
    3,
  );
/** The saved position seeded for the restore test — mid-thread, so the
 * thread-open hold visibly pins the view away from the bottom. */
const RESTORED_TOP = 120;
/** A saved position deep in a long thread's history — among the rows that
 * mount dormant. */
const LONG_RESTORED_TOP = 4000;

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
  onEditSubmit,
  forceVoicePillMessageId,
}: {
  items: readonly ChatMessageItem[];
  threadId: string;
  intentRef: MutableRefObject<boolean | 'smooth'>;
  isGenerating: boolean;
  onEditSubmit?: (message: ChatMessageView, text: string) => Promise<boolean>;
  forceVoicePillMessageId?: string;
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
        onEditSubmit={onEditSubmit}
        forceVoicePillMessageId={forceVoicePillMessageId}
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

/** Observe the first moving frame, rather than guessing how far the browser
 * has glided after a wall-clock delay. Fast frames can already be near the
 * target by then, making a correct cancellation look like a failure. */
async function waitForGlide(log: HTMLElement, initialTop: number) {
  const started = performance.now();
  await new Promise<void>((resolve, reject) => {
    const observe = () => {
      if (log.scrollTop > initialTop) {
        resolve();
        return;
      }
      if (performance.now() - started >= 2000) {
        reject(new Error('The send glide did not start'));
        return;
      }
      requestAnimationFrame(observe);
    };
    requestAnimationFrame(observe);
  });
  expect(log.scrollTop).toBeGreaterThan(initialTop);
  expect(snapTarget(log) - log.scrollTop).toBeGreaterThan(40);
}

beforeAll(() => {
  // Seeded BEFORE the first mount: the hook loads the persisted positions
  // once per module instance.
  window.sessionStorage.setItem(
    'tale_chat_scroll_positions',
    JSON.stringify({
      'thread-restore': RESTORED_TOP,
      'thread-long-restore': LONG_RESTORED_TOP,
    }),
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
    const initialTop = log.scrollTop;

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
    await waitForGlide(log, initialTop);
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
    const initialTop = log.scrollTop;

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
    await waitForGlide(log, initialTop);
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
    // Three more replies: more than the response slack under the anchored
    // question can absorb, so the growth must lengthen the transcript.
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    rerender(
      <Harness
        items={[
          ...grown,
          extraReply('more-2', 102),
          extraReply('more-3', 103),
          extraReply('more-4', 104),
        ]}
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

/** The first frame after the commit, before any IntersectionObserver report
 * of it: what the user sees first. */
const firstFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve());
  });

const rowsOf = (log: HTMLElement) =>
  Array.from(
    log.querySelectorAll<HTMLElement>('li[data-testid="chat-message"]'),
  );
const isDormant = (row: HTMLElement) => row.hasAttribute('data-dormant');

/** The rows the log shows, wholly or partly. */
function rowsInView(log: HTMLElement): HTMLElement[] {
  const view = log.getBoundingClientRect();
  return rowsOf(log).filter((row) => {
    const rect = row.getBoundingClientRect();
    return rect.bottom > view.top && rect.top < view.bottom;
  });
}

describe('MessageThread long thread', () => {
  it('lands a new send while dormant history wakes during its glide', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const items = toSettledItems(conversation(120));
    const { rerender } = render(
      <Harness
        items={items}
        threadId="thread-long-send"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    const first = rowsOf(log)[0]!;
    expect(isDormant(first)).toBe(true);

    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    log.dispatchEvent(new Event('scroll'));
    await expect.poll(() => isDormant(first)).toBe(false);
    expect(rowsOf(log).some(isDormant)).toBe(true);

    // Sending from old history crosses dormant rows whose rich bodies can
    // change height as they wake. The live last-user anchor must still land.
    intentRef.current = 'smooth';
    rerender(
      <Harness
        items={[
          ...items,
          ...pendingRows(
            'A question after reading history.',
            'thread-long-send',
          ),
        ]}
        threadId="thread-long-send"
        intentRef={intentRef}
        isGenerating
      />,
    );
    await expect
      .poll(() => Math.abs(log.scrollTop - snapTarget(log)), {
        timeout: 3000,
        interval: 50,
      })
      .toBeLessThanOrEqual(2);
    // Keep checking after landing: a later wake/resize must not leave the
    // pending user message above or below its intended reading position.
    await nextFrame();
    await nextFrame();
    expect(Math.abs(log.scrollTop - snapTarget(log))).toBeLessThanOrEqual(2);
    expect(intentRef.current).toBe(false);
    expect(first.isConnected).toBe(true);
    expect(first).toHaveTextContent('Question 1:');
  });

  it('keeps an awakened older player mounted while playback and focus move', async () => {
    const { unmount } = render(
      <VoiceOutputProvider threadId="thread-long-playback">
        <PlaybackControls />
        <Harness
          items={toSettledItems(conversation(300))}
          threadId="thread-long-playback"
          intentRef={{ current: false }}
          isGenerating={false}
          forceVoicePillMessageId="a0"
        />
      </VoiceOutputProvider>,
    );
    const log = scroller();
    await nextFrame();
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    log.dispatchEvent(new Event('scroll'));
    await expect
      .poll(() => screen.queryByTestId('voice-player-a0'))
      .not.toBeNull();
    const player = screen.getByTestId('voice-player-a0');
    voicePlayer.unmounted.mockClear();
    await page.getByRole('button', { name: 'Start older playback' }).click();

    const middle = rowsOf(log)[300]!;
    middle.tabIndex = -1;
    middle.focus();
    await nextFrame();
    log.scrollTop = log.scrollHeight;
    log.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(player.isConnected).toBe(true);
    expect(document.activeElement).toBe(middle);
    expect(voicePlayer.unmounted).not.toHaveBeenCalledWith('a0');

    // A null chunk means waiting for another chunk, not loss of the owner.
    await page
      .getByRole('button', { name: 'Wait for the next voice chunk' })
      .click();
    await nextFrame();
    expect(player.isConnected).toBe(true);
    expect(voicePlayer.unmounted).not.toHaveBeenCalledWith('a0');
    await page.getByRole('button', { name: 'Stop older playback' }).click();
    await nextFrame();
    // Awake history remains present when stopped, just as when playing.
    expect(player.isConnected).toBe(true);
    expect(voicePlayer.unmounted).not.toHaveBeenCalledWith('a0');
    unmount();
    expect(voicePlayer.unmounted).toHaveBeenCalledWith('a0');
  });

  it('hands focus back to the pencil when an edit is cancelled', async () => {
    render(
      <Harness
        items={toSettledItems(conversation(2))}
        threadId="thread-edit-focus"
        intentRef={{ current: false }}
        isGenerating={false}
        onEditSubmit={async () => false}
      />,
    );
    await nextFrame();
    await page.getByTestId('message-edit-button').first().click();
    const editor = screen.getByRole('textbox');
    await expect.poll(() => document.activeElement).toBe(editor);

    await userEvent.keyboard('{Escape}');
    await expect
      .poll(() => document.activeElement?.getAttribute('data-testid'))
      .toBe('message-edit-button');
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
  });

  it('keeps an older edit draft after focus and scroll leave its awake row', async () => {
    render(
      <Harness
        items={toSettledItems(conversation(300))}
        threadId="thread-long-edit"
        intentRef={{ current: false }}
        isGenerating={false}
        onEditSubmit={async () => false}
      />,
    );
    const log = scroller();
    await nextFrame();
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    log.dispatchEvent(new Event('scroll'));
    const first = rowsOf(log)[0]!;
    await expect.poll(() => isDormant(first)).toBe(false);
    await page.getByTestId('message-edit-button').first().click();
    const editor = screen.getByRole('textbox');
    await page.elementLocator(editor).fill('An unsaved older-message draft.');

    const middle = rowsOf(log)[300]!;
    middle.tabIndex = -1;
    middle.focus();
    await nextFrame();
    log.scrollTop = log.scrollHeight;
    log.dispatchEvent(new Event('scroll'));
    await nextFrame();
    expect(editor.isConnected).toBe(true);
    expect(editor).toHaveValue('An unsaved older-message draft.');
    expect(document.activeElement).toBe(middle);
    expect(isDormant(first)).toBe(false);
  });

  it('keeps a draft and focus when a send moves the edited row out of the eager tail', async () => {
    const items = toSettledItems(conversation(12));
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    const onEditSubmit = async () => false;
    const harness = (messages: readonly ChatMessageItem[]) => (
      <Harness
        items={messages}
        threadId="thread-eager-tail-draft"
        intentRef={intentRef}
        isGenerating={false}
        onEditSubmit={onEditSubmit}
      />
    );
    const { rerender } = render(harness(items));
    const log = scroller();
    await nextFrame();
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;
    await page.getByTestId('message-edit-button').first().click();
    const editor = screen.getByRole('textbox');
    await page.elementLocator(editor).fill('Draft from before tail deferral.');
    const first = editor.closest('li')!;
    const last = rowsOf(log).at(-1)!;
    last.tabIndex = -1;
    last.focus();
    await nextFrame();

    // Twenty-four rows were eager; appending a turn marks the first two as
    // deferred. Already-awake controls and drafts must keep their identity.
    rerender(harness(toSettledItems(conversation(13))));
    await nextFrame();
    expect(first.isConnected).toBe(true);
    expect(isDormant(first)).toBe(false);
    expect(editor).toHaveValue('Draft from before tail deferral.');
    expect(document.activeElement).toBe(last);

    rerender(harness(items));
    await nextFrame();
    expect(first.isConnected).toBe(true);
    expect(editor).toHaveValue('Draft from before tail deferral.');
    expect(document.activeElement).toBe(last);
  });

  it('opens on its last turn in full, the history dormant', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    render(
      <Harness
        items={toSettledItems(conversation(40))}
        threadId="thread-long-open"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await firstFrame();

    const inView = rowsInView(log);
    expect(inView.length).toBeGreaterThan(0);
    expect(inView.some(isDormant)).toBe(false);
    expect(isDormant(rowsOf(log)[0]!)).toBe(true);
  });

  it('wakes the rows a restored position shows before the first paint', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    render(
      <Harness
        items={toSettledItems(conversation(40))}
        threadId="thread-long-restore"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await firstFrame();

    expect(Math.round(log.scrollTop)).toBe(LONG_RESTORED_TOP);
    const inView = rowsInView(log);
    expect(inView.length).toBeGreaterThan(0);
    // History rows, mounted dormant, in full by the first frame.
    expect(inView.every((row) => row.getAttribute('aria-live') === 'off')).toBe(
      true,
    );
    expect(inView.some(isDormant)).toBe(false);
  });

  it('wakes the rows the user scrolls toward, and only those', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    render(
      <Harness
        items={toSettledItems(conversation(40))}
        threadId="thread-long-scroll"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    const first = rowsOf(log)[0]!;
    expect(isDormant(first)).toBe(true);

    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));
    log.scrollTop = 0;

    await expect
      .poll(() => isDormant(first), { timeout: 2000, interval: 50 })
      .toBe(false);
    // Rows far from the view on either side stay dormant.
    const view = log.getBoundingClientRect();
    const far = rowsOf(log).filter(
      (row) => row.getBoundingClientRect().top > view.bottom + 4 * view.height,
    );
    expect(far.some(isDormant)).toBe(true);
  });

  it('lets the keyboard walk up into the history', async () => {
    // Dormant rows hold no controls: the rows ahead of the focus must wake
    // before Shift+Tab reaches them, or focus would leave the transcript.
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    render(
      <Harness
        items={toSettledItems(conversation(40))}
        threadId="thread-long-keys"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    await nextFrame();
    const bornDormant = (row: HTMLElement | null | undefined) =>
      row?.getAttribute('aria-live') === 'off';
    const focusedRow = () =>
      document.activeElement?.closest<HTMLElement>(
        'li[data-testid="chat-message"]',
      );
    const copies = screen.getAllByRole('button', { name: 'Copy' });
    copies.at(-1)!.focus();

    for (let press = 0; press < 300 && !bornDormant(focusedRow()); press += 1) {
      await userEvent.keyboard('{Shift>}{Tab}{/Shift}');
      await nextFrame();
    }

    const row = focusedRow();
    expect(bornDormant(row)).toBe(true);
    expect(isDormant(row!)).toBe(false);
  });

  it('never jumps the rows in view while the history above them renders', async () => {
    const intentRef: MutableRefObject<boolean | 'smooth'> = { current: false };
    render(
      <Harness
        items={toSettledItems(conversation(40))}
        threadId="thread-long-anchor"
        intentRef={intentRef}
        isGenerating={false}
      />,
    );
    const log = scroller();
    await nextFrame();
    log.dispatchEvent(new WheelEvent('wheel', { deltaY: -3, bubbles: true }));

    const step = Math.round(log.clientHeight / 2);
    while (log.scrollTop > step) {
      const view = log.getBoundingClientRect();
      const anchor = rowsInView(log).find(
        (row) => row.getBoundingClientRect().top >= view.top,
      )!;
      const before = anchor.getBoundingClientRect().top;
      log.scrollTop -= step;
      await nextFrame();
      await nextFrame();
      // The row moved by the scroll and nothing else.
      expect(
        Math.abs(anchor.getBoundingClientRect().top - before - step),
      ).toBeLessThanOrEqual(1);
    }
    expect(rowsOf(log).filter(isDormant).length).toBeLessThan(
      rowsOf(log).length / 2,
    );
  });
});
