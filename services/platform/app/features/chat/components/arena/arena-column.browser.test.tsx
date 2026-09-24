import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { act, cleanup, render, screen } from '@/tests/utils/render';

import {
  useChatGeneration,
  useChatGenerationText,
  type ChatQuery,
} from '../../data/chat-backend';
import type { ChatMessageView } from '../../types';
import { ArenaColumn, type ArenaRound } from './arena-column';

import '@/app/globals.css';

/**
 * An arena send, laid out and scrolled by a real browser: the round the
 * composer fans out shows in the column as its own optimistic send and the
 * send-snap glides it to the top — the reply streams into the view, not
 * below the fold — and the real rows take the bubble over in place.
 */

vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

// The transcript read is a subscription, as the live query is: a refetch
// re-renders the column by itself, never through its parent.
const messages = vi.hoisted(() => {
  let current: ChatQuery<readonly ChatMessageView[]> = { status: 'loading' };
  const listeners = new Set<() => void>();
  return {
    serve: (rows: readonly ChatMessageView[]) => {
      current = { status: 'ready', data: rows };
      for (const listener of listeners) listener();
    },
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    read: () => current,
  };
});

// The column's three live reads, answered by the test: no backend here.
vi.mock('../../data/chat-backend', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('../../data/chat-backend')>();
  const { useSyncExternalStore } = await import('react');
  return {
    ...actual,
    useChatMessages: () =>
      useSyncExternalStore(messages.subscribe, messages.read),
    useChatGeneration: vi.fn(),
    useChatGenerationText: vi.fn(),
  };
});

const PARAGRAPH =
  'Rivers carry sediment toward the sea, and where the current slows the load settles into banks, bars and channels that split and rejoin. '.repeat(
    3,
  );

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

function Harness({
  threadId,
  round,
}: {
  threadId: string;
  round?: ArenaRound;
}) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        width: 700,
        height: 600,
      }}
    >
      <ArenaColumn
        organizationId="org-1"
        threadId={threadId}
        label="Model A"
        round={round}
      />
    </div>
  );
}

const scroller = () => screen.getByRole('log');

const nextFrame = () =>
  new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });

const userRows = (log: HTMLElement) =>
  Array.from(log.querySelectorAll<HTMLElement>('li[data-message-role="user"]'));

/** How far the last user message sits below the column's top inset. */
function lastUserOffset(log: HTMLElement): number {
  const content = log.firstElementChild as HTMLElement;
  const pad = parseFloat(getComputedStyle(content).paddingTop) || 16;
  const last = userRows(log).at(-1)!;
  return (
    last.getBoundingClientRect().top - log.getBoundingClientRect().top - pad
  );
}

beforeEach(async () => {
  await page.viewport(1000, 720);
  vi.mocked(useChatGeneration).mockReturnValue({
    status: 'ready',
    data: null,
  });
  vi.mocked(useChatGenerationText).mockReturnValue({
    status: 'ready',
    data: null,
  });
});

afterEach(() => {
  cleanup();
});

describe('ArenaColumn send', () => {
  it('glides the sent round to the top of the column', async () => {
    const history = conversation(6);
    messages.serve(history);
    const { rerender } = render(<Harness threadId="arena-snap" />);
    const log = scroller();
    await nextFrame();
    // An opened column rests at its natural bottom, the last reply above
    // the fold's end — the prompt about to be sent has no room above it.
    log.scrollTop = log.scrollHeight;
    await nextFrame();

    rerender(
      <Harness
        threadId="arena-snap"
        round={{ text: 'And the delta?', sentAt: 1_700_000_000_001 }}
      />,
    );
    // The bubble shows at once, before any round-trip…
    expect(userRows(log).at(-1)).toHaveTextContent('And the delta?');
    // …and lands under the top inset, the reply's space beneath it.
    await expect
      .poll(() => Math.abs(lastUserOffset(log)), {
        timeout: 2000,
        interval: 50,
      })
      .toBeLessThanOrEqual(2);
    // The glide eases frame by frame, so the bubble is within 2px of the top
    // a frame or two before the column comes to rest at its end; wait for the
    // landing rather than reading the scroll mid-flight (a slow runner caught
    // it 2px short).
    await expect
      .poll(() => log.scrollHeight - log.scrollTop - log.clientHeight, {
        timeout: 2000,
        interval: 50,
      })
      .toBeLessThanOrEqual(1);
  });

  it('hands the bubble to the real rows in place', async () => {
    const history = conversation(6);
    messages.serve(history);
    const round = { text: 'And the estuary?', sentAt: 1_700_000_000_002 };
    const { rerender } = render(<Harness threadId="arena-adopt" />);
    const log = scroller();
    await nextFrame();

    rerender(<Harness threadId="arena-adopt" round={round} />);
    await expect
      .poll(() => Math.abs(lastUserOffset(log)), {
        timeout: 2000,
        interval: 50,
      })
      .toBeLessThanOrEqual(2);
    const bubble = userRows(log).at(-1)!;

    // The turn opened: the transcript now carries the prompt and the reply.
    act(() => {
      messages.serve([
        ...history,
        {
          id: 'u-sent',
          role: 'user',
          sequence: 13,
          createdAt: 13,
          parts: [{ type: 'text', text: round.text }],
        },
        {
          id: 'a-sent',
          role: 'assistant',
          sequence: 14,
          createdAt: 14,
          parts: [{ type: 'text', text: 'Where the river meets the sea.' }],
        },
      ]);
    });
    // The round resolved: the surface withdraws it.
    rerender(<Harness threadId="arena-adopt" />);
    await nextFrame();

    const sent = userRows(log).filter((row) =>
      row.textContent?.includes(round.text),
    );
    expect(sent).toHaveLength(1);
    expect(sent[0]).toBe(bubble);
    expect(Math.abs(lastUserOffset(log))).toBeLessThanOrEqual(2);
  });
});
