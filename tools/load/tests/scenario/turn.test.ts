import { describe, expect, test } from 'bun:test';

import { TurnWatch } from '../../src/scenario/turn.ts';

function clock(): { now: () => number; advance: (ms: number) => void } {
  let t = 0;
  return {
    now: () => t,
    advance: (ms) => {
      t += ms;
    },
  };
}

describe('TurnWatch', () => {
  test('first text is the first progress that carries text', async () => {
    const time = clock();
    const watch = new TurnWatch(time.now);
    time.advance(100);
    watch.onEvent({
      kind: 'progress',
      messageId: 'm1',
      text: '',
      cancelRequested: false,
    });
    time.advance(300);
    watch.onEvent({
      kind: 'progress',
      messageId: 'm1',
      text: 'Hello',
      cancelRequested: false,
    });
    time.advance(500);
    watch.onEvent({
      kind: 'progress',
      messageId: 'm1',
      text: 'Hello there',
      cancelRequested: false,
    });
    time.advance(100);
    watch.onEvent({
      kind: 'settled',
      messageId: 'm1',
      status: undefined,
      failed: false,
    });
    const t = watch.timeline;
    expect(t.firstTextAt).toBe(400);
    expect(t.settledAt).toBe(1_000);
    expect(t.messageId).toBe('m1');
    expect(t.lastText).toBe('Hello there');
    expect(t.progressEvents).toBe(3);
    const signal = new AbortController().signal;
    expect(await watch.settled(10, signal)).toBe(true);
    expect(await watch.firstText(10, signal)).toBe(true);
  });

  test('an idle after progress settles a turn whose settled frame was lost', () => {
    const watch = new TurnWatch(() => 0);
    watch.onEvent({ kind: 'idle' });
    expect(watch.timeline.settledAt).toBeNull();
    watch.onEvent({
      kind: 'progress',
      messageId: 'm',
      text: 'x',
      cancelRequested: false,
    });
    watch.onEvent({ kind: 'idle' });
    expect(watch.timeline.settledAt).toBe(0);
  });

  test('waits resolve on the event, at the deadline, or on stop', async () => {
    const watch = new TurnWatch();
    const signal = new AbortController().signal;
    const pending = watch.settled(5_000, signal);
    watch.onEvent({
      kind: 'settled',
      messageId: 'm',
      status: 'cancelled',
      failed: false,
    });
    expect(await pending).toBe(true);
    expect(watch.timeline.settledStatus).toBe('cancelled');

    const idle = new TurnWatch();
    expect(await idle.firstText(20, signal)).toBe(false);
    const controller = new AbortController();
    const stopped = idle.settled(5_000, controller.signal);
    controller.abort();
    expect(await stopped).toBe(false);
  });
});
