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
});
