import { describe, expect, it } from 'vitest';

import {
  HarnessProjection,
  HARNESS_PROGRESS_TEXT_CHARS,
} from './harness_projection';

describe('incremental harness projection', () => {
  it('prefers deltas without duplicating complete blocks and keeps tool order', () => {
    const p = new HarnessProjection();
    p.feed({ type: 'text', text: 'duplicate' });
    p.feed({ type: 'text-delta', text: 'hello' });
    p.feed({
      type: 'tool-use',
      toolUseId: 'a',
      toolName: 'read',
      input: { path: 'x' },
    });
    const before = p.timeline();
    p.feed({ type: 'text-delta', text: ' world' });
    p.feed({ type: 'tool-result', toolUseId: 'a', output: 'done' });
    expect(p.text).toBe('hello world');
    expect(p.timeline()).toEqual([
      { type: 'text', text: 'hello' },
      {
        type: 'tool-read',
        toolCallId: 'a',
        state: 'output-available',
        input: { path: 'x' },
        output: 'done',
      },
      { type: 'text', text: ' world' },
    ]);
    expect(before[1]?.state).toBe('input-available');
  });

  it('bounds retained text and tool payloads while counting every usage event', () => {
    const p = new HarnessProjection();
    let serialized = 0;
    p.feed({
      type: 'tool-use',
      toolUseId: 'huge',
      toolName: 'read',
      input: {
        toJSON: () => {
          serialized++;
          return 'x'.repeat(100_000);
        },
      },
    });
    p.timeline();
    p.timeline();
    expect(serialized).toBe(1);
    for (let i = 0; i < 1000; i++) {
      p.feed({
        type: 'tool-use',
        toolUseId: `t${i}`,
        toolName: 'read',
        input: { i },
      });
      p.feed({ type: 'text-delta', text: 'x'.repeat(1000) });
      p.feed({ type: 'usage', inputTokens: 1, outputTokens: 2 });
    }
    expect(p.text.length).toBeLessThanOrEqual(HARNESS_PROGRESS_TEXT_CHARS + 1);
    expect(p.text.startsWith('…')).toBe(true);
    expect(p.timeline().length).toBeLessThanOrEqual(400);
    expect(p.outputTokens).toBe(2000);
  });
});
