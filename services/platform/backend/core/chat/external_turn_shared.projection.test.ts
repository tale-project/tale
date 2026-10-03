import { describe, expect, it } from 'vitest';

import { HARNESS_RECORD_MAX_CHARS } from '../../../lib/harnesses/jsonl';
import { HarnessProjection } from '../../../lib/harnesses/projection';

describe('bounded incremental harness projection', () => {
  it('prefers deltas and preserves tool ordering/results without retaining raw events', () => {
    const projection = new HarnessProjection();
    projection.accept({
      type: 'turn-started',
      harness: 'claude-code',
      sessionId: 'conversation',
    });
    projection.accept({ type: 'text', text: 'complete duplicate' });
    projection.accept({ type: 'text-delta', text: 'before' });
    projection.accept({
      type: 'tool-use',
      toolUseId: 'call',
      toolName: 'read',
      input: { path: 'file' },
    });
    projection.accept({ type: 'text-delta', text: 'after' });
    projection.accept({
      type: 'tool-result',
      toolUseId: 'call',
      output: 'result',
    });
    projection.accept({ type: 'usage', inputTokens: 3, outputTokens: 4 });
    expect(projection.answerText).toBe('beforeafter');
    expect(projection.timeline()).toEqual([
      { type: 'text', text: 'before' },
      {
        type: 'tool-read',
        state: 'output-available',
        toolCallId: 'call',
        input: { path: 'file' },
        output: 'result',
      },
      { type: 'text', text: 'after' },
    ]);
  });

  it.each(['text', 'text-delta'] as const)(
    'keeps %s functional output exact beyond the display cap',
    (type) => {
      const projection = new HarnessProjection();
      const text = 'first-line\n' + 'x'.repeat(80_000) + '\nlast-line';
      projection.accept({ type, text });
      projection.accept({
        type: 'turn-ended',
        status: 'completed',
        finalText: text,
      });
      expect(projection.answerText).toBe(text);
      expect(projection.text.length).toBeLessThanOrEqual(32_001);
    },
  );

  it('refuses an oversized final narrative explicitly instead of truncating it', () => {
    const projection = new HarnessProjection();
    projection.accept({
      type: 'text-delta',
      text: 'x'.repeat(HARNESS_RECORD_MAX_CHARS),
    });
    expect(() =>
      projection.accept({ type: 'text-delta', text: 'overflow' }),
    ).toThrow('Harness final answer exceeds');
  });

  it('bounds heavy display output and does not mutate published snapshots', () => {
    const projection = new HarnessProjection();
    projection.accept({
      type: 'tool-use',
      toolUseId: 'first',
      toolName: 'read',
      input: {},
    });
    const earlier = projection.timeline();
    projection.accept({
      type: 'tool-result',
      toolUseId: 'first',
      output: 'later',
    });
    expect(earlier[0]?.state).toBe('input-available');
    for (let i = 0; i < 2_000; i++) {
      projection.accept({ type: 'text-delta', text: 'x'.repeat(1_000) });
      projection.accept({
        type: 'tool-use',
        toolUseId: String(i),
        toolName: 'read',
        input: 'x'.repeat(10_000),
      });
      projection.accept({
        type: 'tool-result',
        toolUseId: String(i),
        output: 'y'.repeat(10_000),
      });
    }
    projection.accept({
      type: 'turn-ended',
      status: 'completed',
      sessionId: 'late-id',
      finalText: 'done',
    });
    expect(projection.text.length).toBeLessThanOrEqual(32_001);
    expect(projection.timeline().length).toBeLessThanOrEqual(400);
    expect(
      Buffer.byteLength(JSON.stringify(projection.timeline())),
    ).toBeLessThanOrEqual(600_000);
  });
});
