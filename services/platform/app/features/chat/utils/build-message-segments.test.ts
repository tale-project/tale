import { describe, expect, it } from 'vitest';

import { buildMessageSegments } from './build-message-segments';

describe('buildMessageSegments', () => {
  it('returns empty for undefined/empty parts', () => {
    expect(buildMessageSegments(undefined)).toEqual({
      segments: [],
      toolCount: 0,
      skillCount: 0,
      hasReasoning: false,
      isStreaming: false,
    });
    expect(buildMessageSegments([]).segments).toEqual([]);
  });

  it('preserves chronological interleave: text → reasoning → tool → text', () => {
    const { segments } = buildMessageSegments([
      { type: 'text', text: 'Here is the plan.', state: 'done' },
      { type: 'reasoning', text: 'I should check auth first.', state: 'done' },
      { type: 'tool-file_read', toolCallId: 'r1', state: 'output-available' },
      { type: 'text', text: 'The auth flow uses JWT.', state: 'streaming' },
    ]);
    expect(segments.map((s) => s.kind)).toEqual([
      'text',
      'reasoning',
      'tool',
      'text',
    ]);
  });

  it('marks only the final text run isLast', () => {
    const { segments } = buildMessageSegments([
      { type: 'text', text: 'a', state: 'done' },
      { type: 'reasoning', text: 'r', state: 'done' },
      { type: 'text', text: 'b', state: 'streaming' },
    ]);
    const textSegs = segments.filter((s) => s.kind === 'text');
    expect(textSegs.map((s) => (s.kind === 'text' ? s.isLast : null))).toEqual([
      false,
      true,
    ]);
  });

  it('coalesces adjacent text parts into one segment (later state wins)', () => {
    const { segments } = buildMessageSegments([
      { type: 'text', text: 'Hello ', state: 'done' },
      { type: 'text', text: 'world', state: 'streaming' },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'text',
      text: 'Hello world',
      state: 'streaming',
      isLast: true,
    });
  });

  it('dedupes a tool that transitions input→output in place', () => {
    const { segments, toolCount } = buildMessageSegments([
      { type: 'tool-web', toolCallId: 'w1', state: 'input-available' },
      {
        type: 'tool-web',
        toolCallId: 'w1',
        state: 'output-available',
        output: 'ok',
      },
    ]);
    expect(segments).toHaveLength(1);
    expect(segments[0]).toMatchObject({
      kind: 'tool',
      state: 'output-available',
    });
    expect(toolCount).toBe(1);
  });

  it('passes a folded Task tool-result output through intact, counted as one tool', () => {
    // A sub-agent Task whose `output` carries `{report, steps}` (what the
    // persisted path yields after toUIMessages unwraps the json tool-result):
    // the nested steps are NOT separate top-level tools.
    const folded = {
      report: '## Report',
      steps: [{ toolName: 'WebSearch', output: 'hits' }],
    };
    const { segments, toolCount } = buildMessageSegments([
      {
        type: 'tool-Task',
        toolCallId: 'task1',
        state: 'output-available',
        input: { description: 'Research' },
        output: folded,
      },
    ]);
    expect(segments).toHaveLength(1);
    expect(toolCount).toBe(1);
    expect((segments[0] as { output: unknown }).output).toEqual(folded);
  });

  it('detects redacted reasoning (done + empty)', () => {
    const { segments, hasReasoning } = buildMessageSegments([
      { type: 'reasoning', text: '', state: 'done' },
    ]);
    expect(segments[0]).toMatchObject({ kind: 'reasoning', redacted: true });
    expect(hasReasoning).toBe(false);
  });

  it('flags isStreaming for a still-streaming trailing text run', () => {
    expect(
      buildMessageSegments([
        { type: 'text', text: 'partial', state: 'streaming' },
      ]).isStreaming,
    ).toBe(true);
    expect(
      buildMessageSegments([{ type: 'text', text: 'done', state: 'done' }])
        .isStreaming,
    ).toBe(false);
  });

  it('counts skills separately from tools', () => {
    const { toolCount, skillCount } = buildMessageSegments([
      { type: 'tool-web', toolCallId: 'w', state: 'output-available' },
      {
        type: 'tool-expand_skill',
        toolCallId: 's1',
        state: 'output-available',
        input: { skillSlug: 'pdf' },
      },
      {
        type: 'tool-read_skill_file',
        toolCallId: 's2',
        state: 'output-available',
        input: { skillSlug: 'pdf' },
      },
    ]);
    expect(toolCount).toBe(1);
    expect(skillCount).toBe(1);
  });

  it('ignores file, source and step-start parts (text is kept)', () => {
    const { segments } = buildMessageSegments([
      { type: 'step-start' },
      { type: 'text', text: 'the answer', state: 'done' },
      { type: 'file', url: 'x', mediaType: 'image/png' },
      { type: 'source-url', url: 'x' },
    ]);
    expect(segments.map((s) => s.kind)).toEqual(['text']);
  });

  it('marks isStreaming while a tool is mid-flight', () => {
    expect(
      buildMessageSegments([
        { type: 'tool-web', toolCallId: 't1', state: 'input-streaming' },
      ]).isStreaming,
    ).toBe(true);
  });

  it('surfaces tool errors with errorText', () => {
    const { segments, toolCount, isStreaming } = buildMessageSegments([
      {
        type: 'tool-web',
        toolCallId: 't1',
        state: 'output-error',
        errorText: 'boom',
      },
    ]);
    expect(segments[0]).toMatchObject({
      kind: 'tool',
      state: 'output-error',
      errorText: 'boom',
    });
    expect(toolCount).toBe(1);
    expect(isStreaming).toBe(false);
  });

  it('skips tool-invocation and empty tool names', () => {
    const { segments, toolCount } = buildMessageSegments([
      { type: 'tool-invocation', toolCallId: 't1', state: 'input-available' },
      { type: 'tool-', toolCallId: 't2', state: 'input-available' },
    ]);
    expect(segments).toHaveLength(0);
    expect(toolCount).toBe(0);
  });

  it('counts distinct tool calls', () => {
    const { segments, toolCount } = buildMessageSegments([
      { type: 'tool-web', toolCallId: 't1', state: 'output-available' },
      { type: 'tool-rag_search', toolCallId: 't2', state: 'output-available' },
      { type: 'tool-web', toolCallId: 't3', state: 'output-available' },
    ]);
    expect(toolCount).toBe(3);
    expect(segments).toHaveLength(3);
  });

  it('tolerates malformed entries', () => {
    const { segments } = buildMessageSegments([
      null,
      42,
      { noType: true },
      { type: 'reasoning', text: 'ok', state: 'done' },
    ] as unknown[]);
    expect(segments).toHaveLength(1);
  });
});
