import { describe, expect, it, vi } from 'vitest';

import type { ActionCtx } from '../lib/ctx';
import { liveProgressSink } from './agent_host';

const keys = {
  organizationId: 'org-a',
  sessionId: 'session-a',
  execId: 'exec-a',
};

describe('liveProgressSink backpressure', () => {
  it('combines paired fields and retains only the latest snapshot behind a slow write', async () => {
    const gate = Promise.withResolvers<void>();
    const writes: Record<string, unknown>[] = [];
    const runMutation = vi.fn(
      async (_ref: unknown, args: Record<string, unknown>) => {
        writes.push(args);
        if (writes.length === 1) await gate.promise;
      },
    );
    const sink = liveProgressSink({ runMutation } as never, keys, 'task-agent');
    sink.onText('first');
    sink.onTimeline([{ type: 'text', text: 'first' }]);
    await Promise.resolve();
    for (let i = 0; i < 100; i++) {
      sink.onText(`text ${i}`);
      sink.onTimeline([{ type: 'text', text: `text ${i}` }]);
    }
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      progressText: 'first',
      liveTimeline: [{ type: 'text', text: 'first' }],
    });
    let flushed = false;
    const flush = sink.flush().then(() => {
      flushed = true;
    });
    await Promise.resolve();
    expect(flushed).toBe(false);
    gate.resolve();
    await flush;
    expect(writes).toHaveLength(2);
    expect(writes[1]).toMatchObject({
      progressText: 'text 99',
      liveTimeline: [{ type: 'text', text: 'text 99' }],
      ...keys,
    });
    // A later emission after an idle flush starts another drain.
    sink.onText('final');
    await sink.flush();
    expect(writes).toHaveLength(3);
    expect(writes[2]?.progressText).toBe('final');
  });

  it('continues after a failed write and preserves fields that update separately', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const gate = Promise.withResolvers<void>();
    const runMutation = vi
      .fn()
      .mockImplementationOnce(async () => {
        await gate.promise;
        throw new Error('database unavailable');
      })
      .mockResolvedValue(null);
    const sink = liveProgressSink(
      { runMutation } as never,
      keys,
      'workflow-agent',
    );
    sink.onText('first');
    await Promise.resolve();
    sink.onText('second');
    sink.onTimeline([{ type: 'text', text: 'tool activity' }]);
    gate.resolve();
    await sink.flush();
    expect(runMutation).toHaveBeenCalledTimes(2);
    expect(runMutation.mock.calls[1]?.[1]).toMatchObject({
      progressText: 'second',
      liveTimeline: [{ type: 'text', text: 'tool activity' }],
    });
  });
});

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
