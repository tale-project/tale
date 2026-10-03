import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { liveProgressSink } from './agent_host';

const keys = { organizationId: 'org', sessionId: 'session', execId: 'exec' };

describe('agent progress backpressure', () => {
  it('writes simultaneous text and transcript changes together', async () => {
    const runMutation = vi.fn().mockResolvedValue(null);
    const sink = liveProgressSink(
      { runMutation } as unknown as ActionCtx,
      keys,
      'task-agent',
    );
    sink.onText('Working');
    sink.onTimeline([{ type: 'text', text: 'Working' }]);
    await sink.flush();
    expect(runMutation).toHaveBeenCalledTimes(1);
    expect(runMutation.mock.calls[0]?.[1]).toMatchObject({
      progressText: 'Working',
      liveTimeline: [{ type: 'text', text: 'Working' }],
    });
  });

  it('keeps one merged pending snapshot behind a slow write, preserving intervening tools', async () => {
    let release: () => void = () => {};
    const blocked = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runMutation = vi
      .fn()
      .mockImplementationOnce(() => blocked)
      .mockResolvedValue(null);
    const sink = liveProgressSink(
      { runMutation } as unknown as ActionCtx,
      keys,
      'task-agent',
    );
    sink.onText('First');
    await Promise.resolve();
    expect(runMutation).toHaveBeenCalledTimes(1);
    for (let n = 0; n < 100; n++) {
      sink.onText(`Update ${n}`);
      sink.onTimeline([
        {
          type: 'tool-test',
          toolCallId: `tool-${n}`,
          state: 'input-available',
        },
      ]);
    }
    let flushed = false;
    const flushing = sink.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    release();
    await flushing;
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      progressText: 'Update 99',
    });
    expect(runMutation.mock.calls[1]?.[1].liveTimeline).toHaveLength(100);
  });

  it('bounds pending transcript history and continues after a failed write', async () => {
    const runMutation = vi
      .fn()
      .mockRejectedValueOnce(new Error('storage unavailable'))
      .mockResolvedValue(null);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const sink = liveProgressSink(
      { runMutation } as unknown as ActionCtx,
      keys,
      'workflow-agent',
    );
    sink.onText('First');
    await sink.flush();
    for (let n = 0; n < 500; n++) {
      sink.onTimeline([{ type: 'tool-test', toolCallId: `tool-${n}` }]);
    }
    await sink.flush();
    expect(runMutation.mock.calls[1]?.[1].liveTimeline).toHaveLength(400);
    expect(runMutation.mock.calls[1]?.[1].liveTimeline.at(-1).toolCallId).toBe(
      'tool-499',
    );
    warn.mockRestore();
  });
});

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
