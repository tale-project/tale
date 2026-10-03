import { describe, expect, it, vi } from 'vitest';

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
