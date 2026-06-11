import type { AgentEvent } from '@tale/agent-adapters';
import { describe, it, expect } from 'vitest';

import { buildAssistantContent } from './agent_message_parts';

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
});
