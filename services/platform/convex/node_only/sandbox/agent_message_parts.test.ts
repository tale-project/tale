import type { AgentEvent } from '@tale/agent-adapters';
import { describe, it, expect } from 'vitest';

import {
  buildAssistantContent,
  estimateContentBytes,
  MAX_MESSAGE_BYTES,
} from './agent_message_parts';

describe('buildAssistantContent', () => {
  it('returns a plain string when the turn made no tool calls', () => {
    expect(buildAssistantContent([], 'just the answer')).toBe(
      'just the answer',
    );
    expect(
      buildAssistantContent([{ type: 'text', text: 'hello' }], 'hello'),
    ).toBe('hello');
  });

  it('maps text→text and tool-use+result into paired parts, in order', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Let me run it.' },
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Bash',
        input: { command: 'echo hi' },
      },
      { type: 'tool-result', toolUseId: 't1', output: 'hi', isError: false },
      { type: 'text', text: 'Output: hi' },
    ];
    const content = buildAssistantContent(events, 'Output: hi');
    expect(Array.isArray(content)).toBe(true);
    const parts = content as Array<Record<string, unknown>>;
    expect(parts[0]).toEqual({ type: 'text', text: 'Let me run it.' });
    expect(parts[1]).toEqual({
      type: 'tool-call',
      toolCallId: 't1',
      toolName: 'Bash',
      input: { command: 'echo hi' },
      providerExecuted: true,
    });
    expect(parts[2]).toEqual({
      type: 'tool-result',
      toolCallId: 't1',
      toolName: 'Bash', // paired from the prior tool-use
      output: { type: 'text', value: 'hi' },
    });
    // final answer (already the last text block) is NOT duplicated
    expect(parts[3]).toEqual({ type: 'text', text: 'Output: hi' });
    expect(parts).toHaveLength(4);
  });

  it('appends finalText for a tool-only turn (no trailing text block)', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
    ];
    const parts = buildAssistantContent(events, 'Done.') as Array<
      Record<string, unknown>
    >;
    expect(parts[parts.length - 1]).toEqual({ type: 'text', text: 'Done.' });
  });

  it('marks errored results as error-text', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'boom', isError: true },
    ];
    const parts = buildAssistantContent(events, '') as Array<
      Record<string, unknown>
    >;
    expect(parts[1]).toMatchObject({
      type: 'tool-result',
      output: { type: 'error-text', value: 'boom' },
    });
  });

  it('stringifies non-string output and clamps oversized output', () => {
    const big = 'x'.repeat(20_000);
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Read', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: big, isError: false },
      { type: 'tool-use', toolUseId: 't2', toolName: 'X', input: {} },
      {
        type: 'tool-result',
        toolUseId: 't2',
        output: { a: 1, b: [2, 3] },
        isError: false,
      },
    ];
    const parts = buildAssistantContent(events, 'done') as unknown as Array<{
      output?: { value: string };
    }>;
    const out1 = parts[1].output as { value: string };
    expect(out1.value.length).toBeLessThan(big.length);
    expect(out1.value.endsWith('… (truncated)')).toBe(true);
    const out2 = parts[3].output as { value: string };
    expect(out2.value).toBe('{"a":1,"b":[2,3]}');
  });

  it('pairs a standalone tool-result (OpenCode inline) with a fallback name', () => {
    const events: AgentEvent[] = [
      { type: 'tool-result', toolUseId: 'solo', output: 'ok', isError: false },
    ];
    const parts = buildAssistantContent(events, '') as Array<
      Record<string, unknown>
    >;
    expect(parts[0]).toMatchObject({
      type: 'tool-result',
      toolCallId: 'solo',
      toolName: 'tool',
    });
  });

  it('names a cross-seam orphan result from the knownToolNames seed', () => {
    // The tool-use happened in a PREVIOUS segment (S4 seam) — this segment's
    // timeline only has the result. The seed carried via the checkpoint must
    // name it; without it the row would render as a bare "Tool".
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        toolUseId: 'pre1',
        output: 'done',
        isError: false,
      },
      {
        type: 'tool-result',
        toolUseId: 'mystery',
        output: '?',
        isError: false,
      },
    ];
    const parts = buildAssistantContent(
      events,
      '',
      new Map([['pre1', 'Agent']]),
    ) as Array<Record<string, unknown>>;
    expect(parts[0]).toMatchObject({ toolCallId: 'pre1', toolName: 'Agent' });
    // Unknown ids still fall back rather than throw.
    expect(parts[1]).toMatchObject({ toolCallId: 'mystery', toolName: 'tool' });
  });

  it('lets a same-segment tool-use refresh a stale seed entry', () => {
    const events: AgentEvent[] = [
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'WebFetch',
        input: { url: 'https://example.com' },
      },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
    ];
    const parts = buildAssistantContent(
      events,
      '',
      new Map([['t1', 'StaleName']]),
    ) as Array<Record<string, unknown>>;
    expect(parts[1]).toMatchObject({ toolCallId: 't1', toolName: 'WebFetch' });
  });
});

describe('estimateContentBytes (S4 segmentation guard)', () => {
  it('measures a plain string by UTF-8 byte length, not char count', () => {
    expect(estimateContentBytes('abc')).toBe(3);
    // a multi-byte char counts its real encoded size (ä = 2 bytes)
    expect(estimateContentBytes('ä')).toBe(2);
  });

  it('measures structured content by serialized size (inputs + outputs)', () => {
    const content = buildAssistantContent(
      [
        { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
        {
          type: 'tool-result',
          toolUseId: 't1',
          output: 'x'.repeat(1000),
          isError: false,
        },
      ],
      'done',
    );
    // The 1000-char tool output dominates → well over the bare text length.
    expect(estimateContentBytes(content)).toBeGreaterThan(1000);
  });

  it('a long tool-call timeline crosses MAX_MESSAGE_BYTES (the seam premise)', () => {
    // ~5000 tool calls, each with a sizeable clamped output — the accumulation
    // a long task would produce in ONE message. The guard trips well before the
    // 1 MB doc cap, so the run hands off and segments.
    const events: AgentEvent[] = [];
    for (let i = 0; i < 5000; i++) {
      events.push({
        type: 'tool-use',
        toolUseId: `t${i}`,
        toolName: 'Bash',
        input: { command: `step-${i}` },
      });
      events.push({
        type: 'tool-result',
        toolUseId: `t${i}`,
        output: `output-${i}-${'y'.repeat(200)}`,
        isError: false,
      });
    }
    const content = buildAssistantContent(events, 'all done');
    expect(estimateContentBytes(content)).toBeGreaterThan(MAX_MESSAGE_BYTES);
  });

  it('a single segment under the cap does NOT trip the guard', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
    ];
    const content = buildAssistantContent(events, 'short answer');
    expect(estimateContentBytes(content)).toBeLessThan(MAX_MESSAGE_BYTES);
  });
});
