// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

import { useThreadStream } from './thread-stream';

/**
 * Which lane events nudge the message and tray reads. `settled` always did;
 * a turn OPENING — the first `progress` over an idle or resolving lane —
 * must too: a parked (send-then-wait) send fires server-side with no
 * optimistic bubble, so without the nudge the transcript lacked its user
 * bubble and the tray kept the row as "Queued" for the whole generation. An
 * `idle` over a streaming lane is a reconnect that missed `settled`.
 */

class FakeEventSource {
  static readonly instances: FakeEventSource[] = [];
  private readonly listeners = new Map<
    string,
    (event: MessageEvent<string>) => void
  >();
  constructor() {
    FakeEventSource.instances.push(this);
  }
  addEventListener(
    name: string,
    listener: (event: MessageEvent<string>) => void,
  ) {
    this.listeners.set(name, listener);
  }
  removeEventListener() {}
  close() {}
  emit(name: string, data = '') {
    act(() => {
      this.listeners.get(name)?.(new MessageEvent(name, { data }));
    });
  }
}

function Probe({
  threadId,
  queryClient,
}: {
  threadId: string;
  queryClient: QueryClient;
}) {
  const state = useThreadStream('org_1', threadId, queryClient);
  return (
    <output>
      {state.generation === undefined
        ? 'resolving'
        : state.generation === null
          ? 'idle'
          : state.generation.status}
    </output>
  );
}

/** Mount one lane and report the entity slot of every invalidation. */
function openLane(threadId: string) {
  const queryClient = new QueryClient();
  const invalidate = vi
    .spyOn(queryClient, 'invalidateQueries')
    .mockResolvedValue(undefined);
  const view = render(<Probe threadId={threadId} queryClient={queryClient} />);
  const source = FakeEventSource.instances.at(-1);
  if (source === undefined) throw new Error('no stream opened');
  const nudged = () =>
    invalidate.mock.calls.map((call) => {
      const [filters] = call;
      const key = filters?.queryKey;
      return Array.isArray(key) ? String(key[2]) : 'unknown';
    });
  return { view, source, nudged, state: () => view.getByRole('status') };
}

const PROGRESS = JSON.stringify({ messageId: 'm_1', text: 'hi' });

beforeAll(() => {
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterAll(() => {
  vi.unstubAllGlobals();
});

describe('useThreadStream read nudges', () => {
  it('refetches the message and tray reads when a turn opens over an idle lane — once per turn', () => {
    const lane = openLane('thread_open');
    lane.source.emit('idle');
    expect(lane.state()).toHaveTextContent('idle');
    expect(lane.nudged()).toEqual([]);

    lane.source.emit('progress', PROGRESS);
    expect(lane.state()).toHaveTextContent('streaming');
    expect(lane.nudged()).toEqual(['chat_message', 'chat_deferred']);

    // Text ticks over a streaming lane nudge nothing.
    lane.source.emit('progress', PROGRESS);
    lane.source.emit('progress', PROGRESS);
    expect(lane.nudged()).toHaveLength(2);

    // Settle keeps its nudge (messages, tray, thread list) — and the next
    // turn opening nudges again.
    lane.source.emit('settled', JSON.stringify({ message: null }));
    expect(lane.state()).toHaveTextContent('idle');
    expect(lane.nudged().slice(2)).toEqual([
      'chat_message',
      'chat_deferred',
      'chat_thread',
    ]);
    lane.source.emit('progress', PROGRESS);
    expect(lane.nudged().slice(5)).toEqual(['chat_message', 'chat_deferred']);
    lane.view.unmount();
  });

  it('refetches when a thread is opened mid-turn (the lane resolves straight into progress)', () => {
    const lane = openLane('thread_midturn');
    expect(lane.state()).toHaveTextContent('resolving');
    lane.source.emit('progress', PROGRESS);
    expect(lane.state()).toHaveTextContent('streaming');
    expect(lane.nudged()).toEqual(['chat_message', 'chat_deferred']);
    lane.view.unmount();
  });

  it('treats an idle over a streaming lane as a missed settle, and an idle over an idle lane as nothing', () => {
    const lane = openLane('thread_reconnect');
    lane.source.emit('idle');
    lane.source.emit('idle');
    expect(lane.nudged()).toEqual([]);

    lane.source.emit('progress', PROGRESS);
    expect(lane.nudged()).toHaveLength(2);
    // The browser reconnected and the open-time probe found the turn over.
    lane.source.emit('idle');
    expect(lane.state()).toHaveTextContent('idle');
    expect(lane.nudged().slice(2)).toEqual([
      'chat_message',
      'chat_deferred',
      'chat_thread',
    ]);
    lane.view.unmount();
  });
});
