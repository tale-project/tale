// @vitest-environment jsdom
import { QueryClient } from '@tanstack/react-query';
import { act, render } from '@testing-library/react';
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { HIDDEN_RELEASE_MS } from '@/app/lib/backend/while-visible';

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
  closed = false;
  close() {
    this.closed = true;
  }
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

let visibility: DocumentVisibilityState = 'visible';

function setVisibility(next: DocumentVisibilityState): void {
  act(() => {
    visibility = next;
    document.dispatchEvent(new Event('visibilitychange'));
  });
}

function overrideVisibility(initial: DocumentVisibilityState): void {
  visibility = initial;
  Object.defineProperty(document, 'visibilityState', {
    configurable: true,
    get: () => visibility,
  });
}

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(document, 'visibilityState');
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

describe('useThreadStream while the tab is hidden', () => {
  it('gives the lane back after the grace, keeps the last state, and reopens on return', () => {
    vi.useFakeTimers();
    overrideVisibility('visible');
    const lane = openLane('thread_hidden');
    lane.source.emit('progress', PROGRESS);
    expect(lane.nudged()).toEqual(['chat_message', 'chat_deferred']);

    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    });
    expect(lane.source.closed).toBe(true);
    // The released lane still paints what it last knew.
    expect(lane.state()).toHaveTextContent('streaming');

    setVisibility('visible');
    const reopened = FakeEventSource.instances.at(-1);
    expect(reopened).not.toBe(lane.source);
    // The turn settled while the tab was away: the reopened lane's probe
    // answers idle, which nudges the reads the missed settle would have.
    reopened?.emit('idle');
    expect(lane.state()).toHaveTextContent('idle');
    expect(lane.nudged().slice(2)).toEqual([
      'chat_message',
      'chat_deferred',
      'chat_thread',
    ]);
    lane.view.unmount();
    expect(reopened?.closed).toBe(true);

    // An unsubscribed lane stops watching: no hide/show brings it back.
    const count = FakeEventSource.instances.length;
    setVisibility('hidden');
    act(() => {
      vi.advanceTimersByTime(HIDDEN_RELEASE_MS);
    });
    setVisibility('visible');
    expect(FakeEventSource.instances).toHaveLength(count);
  });

  it('opens no lane in a background tab until it is first shown', () => {
    overrideVisibility('hidden');
    const before = FakeEventSource.instances.length;
    const view = render(
      <Probe threadId="thread_background" queryClient={new QueryClient()} />,
    );
    expect(FakeEventSource.instances).toHaveLength(before);
    expect(view.getByRole('status')).toHaveTextContent('resolving');

    setVisibility('visible');
    expect(FakeEventSource.instances).toHaveLength(before + 1);
    view.unmount();
  });
});
