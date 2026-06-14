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

describe('buildAssistantContent — sub-agent folding', () => {
  // A main agent launches one Task sub-agent that does a WebSearch and returns
  // a report; then the main agent answers.
  const subAgentTurn = (): AgentEvent[] => [
    { type: 'text', text: "I'll research that." },
    {
      type: 'tool-use',
      toolUseId: 'task1',
      toolName: 'Task',
      input: { description: 'Research' },
    },
    {
      type: 'text',
      text: 'Running searches now.',
      parentToolUseId: 'task1',
    },
    {
      type: 'tool-use',
      toolUseId: 'ws1',
      toolName: 'WebSearch',
      input: { query: 'frameworks' },
      parentToolUseId: 'task1',
    },
    {
      type: 'tool-result',
      toolUseId: 'ws1',
      output: 'LangChain, CrewAI',
      isError: false,
      parentToolUseId: 'task1',
    },
    {
      type: 'text',
      text: '## Report\n\nLangChain leads.',
      parentToolUseId: 'task1',
    },
    {
      type: 'tool-result',
      toolUseId: 'task1',
      output: '## Report\n\nLangChain leads.',
      isError: false,
    },
    { type: 'text', text: 'Summary above.' },
  ];

  it('folds sub-agent steps + report into the parent Task tool-result output', () => {
    const parts = buildAssistantContent(
      subAgentTurn(),
      'Summary above.',
    ) as Array<Record<string, unknown>>;

    // No top-level WebSearch card and no sub-agent narration text leaked.
    expect(
      parts.some((p) => p.type === 'tool-call' && p.toolName === 'WebSearch'),
    ).toBe(false);
    expect(
      parts.some(
        (p) => p.type === 'text' && p.text === 'Running searches now.',
      ),
    ).toBe(false);

    // The Task tool-result carries the folded activity as json output.
    const taskResult = parts.find(
      (p) => p.type === 'tool-result' && p.toolCallId === 'task1',
    ) as {
      output: { type: string; value: { report: string; steps: unknown[] } };
    };
    expect(taskResult.output.type).toBe('json');
    expect(taskResult.output.value.report).toBe(
      '## Report\n\nLangChain leads.',
    );
    expect(taskResult.output.value.steps).toEqual([
      {
        toolName: 'WebSearch',
        input: { query: 'frameworks' },
        output: 'LangChain, CrewAI',
      },
    ]);

    // The Task tool-call card itself is preserved at the top level.
    expect(
      parts.some((p) => p.type === 'tool-call' && p.toolName === 'Task'),
    ).toBe(true);
    // Main-agent text bookends survive.
    expect(parts[0]).toEqual({ type: 'text', text: "I'll research that." });
    expect(parts[parts.length - 1]).toEqual({
      type: 'text',
      text: 'Summary above.',
    });
  });

  it('falls back to the last sub-agent text when the Task result is empty', () => {
    const events = subAgentTurn();
    // Blank the Task tool-result content.
    const idx = events.findIndex(
      (e) => e.type === 'tool-result' && e.toolUseId === 'task1',
    );
    events[idx] = {
      type: 'tool-result',
      toolUseId: 'task1',
      output: '',
      isError: false,
    };
    const parts = buildAssistantContent(events, 'Summary above.') as Array<
      Record<string, unknown>
    >;
    const taskResult = parts.find(
      (p) => p.type === 'tool-result' && p.toolCallId === 'task1',
    ) as { output: { value: { report: string } } };
    expect(taskResult.output.value.report).toBe(
      '## Report\n\nLangChain leads.',
    );
  });

  it('resolves a cross-seam sub-agent result via the knownToolParents seed', () => {
    // The Task tool-use + WebSearch tool-use happened in a PRIOR segment; this
    // segment only sees the sub-agent's tool-result. The seed maps it to its
    // top-level Task so it still folds (not a bare top-level card).
    const events: AgentEvent[] = [
      {
        type: 'tool-result',
        toolUseId: 'ws1',
        output: 'late result',
        isError: false,
        parentToolUseId: 'task1',
      },
      {
        type: 'tool-result',
        toolUseId: 'task1',
        output: 'final report',
        isError: false,
      },
    ];
    const parts = buildAssistantContent(
      events,
      '',
      new Map([['ws1', 'WebSearch']]),
      new Map([['ws1', 'task1']]),
    ) as Array<Record<string, unknown>>;
    // No top-level card for the sub-agent result.
    expect(parts.some((p) => p.toolCallId === 'ws1')).toBe(false);
    const taskResult = parts.find((p) => p.toolCallId === 'task1') as {
      output: {
        type: string;
        value: { steps: Array<{ toolName: string; output: string }> };
      };
    };
    expect(taskResult.output.type).toBe('json');
    expect(taskResult.output.value.steps).toEqual([
      { toolName: 'WebSearch', output: 'late result' },
    ]);
  });

  it('caps a runaway Task step list and records the dropped count', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 'task1', toolName: 'Task', input: {} },
    ];
    // Many fat sub-agent steps to blow past MAX_SUBSTEPS_BYTES (200 KB).
    for (let i = 0; i < 400; i++) {
      events.push({
        type: 'tool-use',
        toolUseId: `s${i}`,
        toolName: 'WebFetch',
        input: { url: `https://x/${i}` },
        parentToolUseId: 'task1',
      });
      events.push({
        type: 'tool-result',
        toolUseId: `s${i}`,
        output: 'z'.repeat(2_000),
        isError: false,
        parentToolUseId: 'task1',
      });
    }
    events.push({
      type: 'tool-result',
      toolUseId: 'task1',
      output: 'report',
      isError: false,
    });
    const parts = buildAssistantContent(events, '') as Array<
      Record<string, unknown>
    >;
    const taskResult = parts.find(
      (p) => p.type === 'tool-result' && p.toolCallId === 'task1',
    ) as {
      output: { value: { steps: unknown[]; truncatedSteps?: number } };
    };
    expect(taskResult.output.value.truncatedSteps).toBeGreaterThan(0);
    expect(taskResult.output.value.steps.length).toBeLessThan(400);
  });

  it('is byte-identical to the pre-fold output for a pure main-agent turn', () => {
    // No parentToolUseId anywhere → the folding pass is a no-op; the Task tool
    // here has no sub-steps so it stays a plain text tool-result.
    const events: AgentEvent[] = [
      {
        type: 'tool-use',
        toolUseId: 'task1',
        toolName: 'Task',
        input: { description: 'x' },
      },
      {
        type: 'tool-result',
        toolUseId: 'task1',
        output: 'plain result',
        isError: false,
      },
    ];
    const parts = buildAssistantContent(events, 'done') as Array<
      Record<string, unknown>
    >;
    expect(
      parts.find((p) => p.type === 'tool-result' && p.toolCallId === 'task1'),
    ).toMatchObject({
      type: 'tool-result',
      output: { type: 'text', value: 'plain result' },
    });
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
