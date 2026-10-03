import { describe, expect, it } from 'vitest';

import { HarnessProjection } from './harness_projection';

describe('bounded harness progress', () => {
  it('does not retain raw events or whole tool payloads and bounds long turns', () => {
    const projection = new HarnessProjection();
    const payload = 'x'.repeat(100_000);
    for (let index = 0; index < 1000; index++) {
      projection.feed({ type: 'raw', harness: 'claude-code', payload });
      projection.feed({ type: 'text-delta', text: payload });
      projection.feed({
        type: 'tool-use',
        toolName: 'Read',
        toolUseId: String(index),
        input: { payload },
      });
      projection.feed({
        type: 'tool-result',
        toolUseId: String(index),
        output: payload,
      });
    }
    expect(projection.text.length).toBeLessThanOrEqual(64_001);
    expect(projection.timeline().length).toBeLessThanOrEqual(400);
    expect(
      Buffer.byteLength(JSON.stringify(projection.snapshot())),
    ).toBeLessThan(400_000);
    expect(projection.timeline().at(-1)).toMatchObject({
      toolCallId: '999',
      state: 'output-available',
    });
  });

  it('restores text/tool state without changing already emitted snapshots', () => {
    const projection = new HarnessProjection();
    projection.feed({ type: 'text-delta', text: 'before' });
    projection.feed({
      type: 'tool-use',
      toolName: 'Read',
      toolUseId: 'call',
      input: {},
    });
    const previous = projection.timeline();
    const restored = new HarnessProjection();
    restored.restore(JSON.parse(JSON.stringify(projection.snapshot())));
    restored.feed({ type: 'tool-result', toolUseId: 'call', output: 'result' });
    restored.feed({ type: 'text-delta', text: 'after' });
    expect(previous.at(-1)?.state).toBe('input-available');
    expect(restored.text).toBe('beforeafter');
    expect(restored.timeline()[1]).toMatchObject({
      state: 'output-available',
      output: 'result',
    });
  });

  it('uses streamed text once even when the CLI repeats complete blocks', () => {
    const projection = new HarnessProjection();
    projection.feed({ type: 'text', text: 'hello' });
    projection.feed({ type: 'text-delta', text: 'hello' });
    projection.feed({ type: 'text', text: 'hello' });
    expect(projection.text).toBe('hello');
    expect(projection.timeline()).toEqual([{ type: 'text', text: 'hello' }]);
  });
});
