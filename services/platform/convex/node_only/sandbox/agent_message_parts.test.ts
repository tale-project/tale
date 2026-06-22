import { describe, it, expect } from 'vitest';

import type { AgentEvent } from '../../../lib/agent-adapters/events';
import {
  buildAssistantContent,
  buildUiPartsFromTimeline,
  capAccumulatedLiveParts,
  estimateContentBytes,
  MAX_LIVE_TIMELINE_PERSIST_BYTES,
  MAX_LIVE_TIMELINE_PERSIST_PARTS,
  MAX_MESSAGE_BYTES,
  type UiTimelinePart,
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

describe('buildAssistantContent — live in-progress text (incremental reveal)', () => {
  // `liveText` is the open MAIN-agent block (delta-accumulated) the streaming
  // flush passes so a long answer renders as it streams; the caller clears it
  // the instant the block's `text` event lands in the timeline.

  it('no-tools, streaming: returns the open block when finalText is empty', () => {
    expect(
      buildAssistantContent([], '', undefined, undefined, 'The history of'),
    ).toBe('The history of');
  });

  it('no-tools, streaming: joins closed blocks with the open block', () => {
    const events: AgentEvent[] = [{ type: 'text', text: 'First paragraph.' }];
    expect(
      buildAssistantContent(events, '', undefined, undefined, 'Second para so'),
    ).toBe('First paragraph.\n\nSecond para so');
  });

  it('no-tools, terminal: finalText wins (liveText already cleared)', () => {
    const events: AgentEvent[] = [{ type: 'text', text: 'the answer' }];
    expect(
      buildAssistantContent(events, 'the answer', undefined, undefined, ''),
    ).toBe('the answer');
  });

  it('tools, streaming: the open block renders as a trailing text part', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
    ];
    const parts = buildAssistantContent(
      events,
      '',
      undefined,
      undefined,
      'Now analyzing the',
    ) as Array<Record<string, unknown>>;
    expect(parts[parts.length - 1]).toEqual({
      type: 'text',
      text: 'Now analyzing the',
    });
  });

  it('coalesce: a completed block (cleared liveText) is never duplicated', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
      { type: 'text', text: 'The final answer.' },
    ];
    const parts = buildAssistantContent(
      events,
      'The final answer.',
      undefined,
      undefined,
      '',
    ) as Array<Record<string, unknown>>;
    const textParts = parts.filter((p) => p.type === 'text');
    expect(textParts).toEqual([{ type: 'text', text: 'The final answer.' }]);
  });

  it('Stop mid-write (no tools): keeps the partial answer', () => {
    expect(
      buildAssistantContent([], '', undefined, undefined, 'partial so far'),
    ).toBe('partial so far');
  });

  it('Stop mid-write (with tools): the partial survives as a trailing part', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'ok', isError: false },
    ];
    const parts = buildAssistantContent(
      events,
      '',
      undefined,
      undefined,
      'partial after tool',
    ) as Array<Record<string, unknown>>;
    expect(
      parts.some((p) => p.type === 'text' && p.text === 'partial after tool'),
    ).toBe(true);
  });

  it('omitting liveText (default) preserves the prior behavior', () => {
    expect(buildAssistantContent([], '')).toBe('');
  });

  it('sub-agent text is not folded into the main body', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'sub narration', parentToolUseId: 'task1' },
    ];
    expect(buildAssistantContent(events, '', undefined, undefined, '')).toBe(
      '',
    );
  });
});

describe('buildUiPartsFromTimeline (live workflow-run transcript)', () => {
  it('returns a single text part for a tool-less turn', () => {
    const parts = buildUiPartsFromTimeline([], 'the answer');
    expect(parts).toEqual([
      { type: 'text', text: 'the answer', state: 'done' },
    ]);
  });

  it('marks the trailing text as streaming while liveText is open', () => {
    const parts = buildUiPartsFromTimeline(
      [],
      '',
      undefined,
      undefined,
      'partial…',
    );
    expect(parts).toEqual([
      { type: 'text', text: 'partial…', state: 'streaming' },
    ]);
  });

  it('merges tool-use + tool-result into one tool-<name> part with input+output', () => {
    const events: AgentEvent[] = [
      { type: 'text', text: 'Running it.' },
      {
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Bash',
        input: { command: 'echo hi' },
      },
      { type: 'tool-result', toolUseId: 't1', output: 'hi', isError: false },
    ];
    const parts = buildUiPartsFromTimeline(events, '') as Array<
      Record<string, unknown>
    >;
    expect(parts[0]).toEqual({
      type: 'text',
      text: 'Running it.',
      state: 'done',
    });
    expect(parts[1]).toMatchObject({
      type: 'tool-Bash',
      toolCallId: 't1',
      state: 'output-available',
      input: { command: 'echo hi' },
      output: 'hi',
    });
  });

  it('leaves an in-flight tool (no result yet) as input-available', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
    ];
    const parts = buildUiPartsFromTimeline(events, '') as Array<
      Record<string, unknown>
    >;
    expect(parts[0]).toMatchObject({
      type: 'tool-Bash',
      state: 'input-available',
    });
  });

  it('marks an errored tool result as output-error with errorText', () => {
    const events: AgentEvent[] = [
      { type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} },
      { type: 'tool-result', toolUseId: 't1', output: 'boom', isError: true },
    ];
    const parts = buildUiPartsFromTimeline(events, '') as Array<
      Record<string, unknown>
    >;
    expect(parts[0]).toMatchObject({
      type: 'tool-Bash',
      state: 'output-error',
      errorText: 'boom',
    });
  });

  it('caps a runaway timeline to a bounded tail with a dropped-head marker', () => {
    const events: AgentEvent[] = [];
    for (let i = 0; i < 500; i++) {
      events.push({
        type: 'tool-use',
        toolUseId: `t${i}`,
        toolName: 'Bash',
        input: { command: `cmd ${i}` },
      });
      events.push({
        type: 'tool-result',
        toolUseId: `t${i}`,
        output: `out ${i}`,
        isError: false,
      });
    }
    const parts = buildUiPartsFromTimeline(events, 'done');
    // Bounded well under any doc-cap concern…
    expect(parts.length).toBeLessThanOrEqual(61);
    // …and the head-drop is signalled rather than silently truncated.
    expect(parts[0]).toMatchObject({ type: 'text' });
    expect((parts[0] as { text: string }).text).toContain('hidden');
  });
});

describe('capAccumulatedLiveParts (cross-segment op transcript)', () => {
  const text = (t: string): UiTimelinePart => ({
    type: 'text',
    text: t,
    state: 'done',
  });
  const tool = (id: string, out: string): UiTimelinePart => ({
    type: 'tool-Bash',
    state: 'output-available',
    toolCallId: id,
    output: out,
  });

  it('appends THIS segment after the prior window, order preserved', () => {
    const prior = [text('seg1-a'), tool('t1', 'out1')];
    const current = [text('seg2-a'), tool('t2', 'out2')];
    expect(capAccumulatedLiveParts(prior, current)).toEqual([
      text('seg1-a'),
      tool('t1', 'out1'),
      text('seg2-a'),
      tool('t2', 'out2'),
    ]);
  });

  it('returns the prior window UNCHANGED when the segment is empty (the idle-seam regression)', () => {
    // The exact failure: a resumed segment that emits nothing (agent waiting on
    // CI) must NOT blank the op — it keeps the prior transcript.
    const prior = [text('clone'), tool('t1', 'pushed PR'), text('waiting…')];
    expect(capAccumulatedLiveParts(prior, [])).toEqual(prior);
  });

  it('an empty prior just yields the current window', () => {
    const current = [text('first'), tool('t1', 'ok')];
    expect(capAccumulatedLiveParts([], current)).toEqual(current);
  });

  it('drops the OLDEST parts past the byte cap, keeping the newest + a marker', () => {
    // ~60 KB each → ~12 parts blow the 512 KB cap; the tail (newest) survives.
    const fat = (i: number): UiTimelinePart =>
      text(`p${i}:${'x'.repeat(60_000)}`);
    const prior = Array.from({ length: 12 }, (_, i) => fat(i));
    const current = [text('NEWEST')];

    const kept = capAccumulatedLiveParts(prior, current);
    const bytes = Buffer.byteLength(JSON.stringify(kept), 'utf8');
    expect(bytes).toBeLessThanOrEqual(MAX_LIVE_TIMELINE_PERSIST_BYTES);
    // Newest segment part is retained at the tail…
    expect(kept[kept.length - 1]).toEqual(current[0]);
    // …the oldest are gone, and the drop is signalled (not silent truncation).
    expect(kept[0]).toMatchObject({ type: 'text' });
    expect((kept[0] as { text: string }).text).toContain('hidden');
    expect(kept).not.toContainEqual(fat(0));
  });

  it('caps the part COUNT, keeping the most recent', () => {
    const prior = Array.from({ length: 300 }, (_, i) => text(`p${i}`));
    const kept = capAccumulatedLiveParts(prior, [text('LAST')]);
    expect(kept.length).toBeLessThanOrEqual(
      MAX_LIVE_TIMELINE_PERSIST_PARTS + 1,
    );
    expect(kept[kept.length - 1]).toEqual(text('LAST'));
    expect((kept[0] as { text: string }).text).toContain('hidden');
  });
});
