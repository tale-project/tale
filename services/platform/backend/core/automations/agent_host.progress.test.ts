// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { liveProgressSink } from './agent_host';

const keys = { organizationId: 'org', sessionId: 'session', execId: 'exec' };

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

afterEach(() => vi.restoreAllMocks());

describe('liveProgressSink backpressure', () => {
  it('keeps one combined pending snapshot while a database write is slow', async () => {
    const first = deferred();
    const write = vi
      .fn()
      .mockImplementationOnce(() => first.promise)
      .mockResolvedValue(undefined);
    const ctx = { runMutation: write } as unknown as ActionCtx;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(100);
    const sink = liveProgressSink(ctx, keys, 'task-agent');
    sink.onText('first');
    sink.onTimeline([
      { type: 'tool-read', toolCallId: 'a', state: 'input-available' },
    ]);
    await Promise.resolve();
    expect(write).toHaveBeenCalledTimes(1);
    clock.mockReturnValue(200);
    for (let i = 0; i < 100; i++) {
      sink.onText(`latest ${i}`);
      sink.onTimeline([
        { type: 'tool-read', toolCallId: `b${i}`, state: 'input-available' },
      ]);
    }
    clock.mockReturnValue(300);
    first.resolve();
    await sink.flush();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[0]?.[1]).toMatchObject({
      progressText: 'first',
      lastEventAt: 100,
    });
    const final = write.mock.calls[1]?.[1];
    expect(final).toMatchObject({
      progressText: 'latest 99',
      lastEventAt: 200,
      heartbeatAt: 200,
    });
    expect(
      final.liveTimeline.map((part: { toolCallId: string }) => part.toolCallId),
    ).toEqual(Array.from({ length: 100 }, (_, i) => `b${i}`));
  });

  it('continues with the latest snapshot after a failed write and waits through flush', async () => {
    const first = deferred();
    const second = deferred();
    const write = vi
      .fn()
      .mockImplementationOnce(async () => {
        await first.promise;
        throw new Error('offline');
      })
      .mockImplementationOnce(() => second.promise);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = liveProgressSink(
      { runMutation: write } as unknown as ActionCtx,
      keys,
      'workflow-agent',
    );
    sink.onText('old');
    await Promise.resolve();
    sink.onText('new');
    const onFlushed = vi.fn();
    const flushed = sink.flush().then(onFlushed);
    first.resolve();
    await vi.waitFor(() => expect(write).toHaveBeenCalledTimes(2));
    expect(onFlushed).not.toHaveBeenCalled();
    second.resolve();
    await flushed;
    expect(onFlushed).toHaveBeenCalledOnce();
    expect(write.mock.calls[1]?.[1]).toMatchObject({ progressText: 'new' });
  });
});
