import { describe, expect, it } from 'vitest';

import {
  buildThoughtTimeline,
  hasThoughtSteps,
  type ThoughtStep,
} from './build-thought-timeline';

describe('buildThoughtTimeline', () => {
  it('returns an empty timeline for undefined/empty parts', () => {
    expect(buildThoughtTimeline(undefined)).toEqual({
      steps: [],
      toolCount: 0,
      hasReasoning: false,
      isStreaming: false,
    });
    expect(buildThoughtTimeline([])).toEqual({
      steps: [],
      toolCount: 0,
      hasReasoning: false,
      isStreaming: false,
    });
  });

  it('ignores text, file, source and step-start parts', () => {
    const tl = buildThoughtTimeline([
      { type: 'step-start' },
      { type: 'text', text: 'the answer' },
      { type: 'file', url: 'x', mediaType: 'image/png' },
      { type: 'source-url', url: 'x' },
    ]);
    expect(tl.steps).toHaveLength(0);
  });

  it('preserves chronological order of interleaved reasoning and tools', () => {
    const tl = buildThoughtTimeline([
      { type: 'reasoning', text: 'first I think', state: 'done' },
      {
        type: 'tool-rag_search',
        toolCallId: 't1',
        state: 'input-available',
        input: { query: 'x' },
      },
      { type: 'reasoning', text: 'now I reflect', state: 'done' },
      {
        type: 'tool-rag_search',
        toolCallId: 't1',
        state: 'output-available',
        input: { query: 'x' },
        output: { hits: 3 },
      },
    ]);

    expect(tl.steps.map((s) => s.kind)).toEqual([
      'reasoning',
      'tool',
      'reasoning',
    ]);
    // Same toolCallId collapses to one step; final state wins.
    expect(tl.toolCount).toBe(1);
    const tool = tl.steps.find((s) => s.kind === 'tool') as Extract<
      ThoughtStep,
      { kind: 'tool' }
    >;
    expect(tool.state).toBe('output-available');
    expect(tool.output).toEqual({ hits: 3 });
    expect(tl.hasReasoning).toBe(true);
    expect(tl.isStreaming).toBe(false);
  });

  it('marks isStreaming while reasoning streams', () => {
    const tl = buildThoughtTimeline([
      { type: 'reasoning', text: 'partial', state: 'streaming' },
    ]);
    expect(tl.isStreaming).toBe(true);
    expect((tl.steps[0] as { state: string }).state).toBe('streaming');
  });

  it('marks isStreaming while a tool is mid-flight', () => {
    const tl = buildThoughtTimeline([
      {
        type: 'tool-web',
        toolCallId: 't1',
        state: 'input-streaming',
        input: {},
      },
    ]);
    expect(tl.isStreaming).toBe(true);
  });

  it('treats a done reasoning block with no text as redacted', () => {
    const tl = buildThoughtTimeline([
      { type: 'reasoning', text: '   ', state: 'done' },
    ]);
    const step = tl.steps[0] as Extract<ThoughtStep, { kind: 'reasoning' }>;
    expect(step.redacted).toBe(true);
    expect(tl.hasReasoning).toBe(false);
  });

  it('surfaces tool errors with errorText', () => {
    const tl = buildThoughtTimeline([
      {
        type: 'tool-web',
        toolCallId: 't1',
        state: 'output-error',
        errorText: 'boom',
      },
    ]);
    const step = tl.steps[0] as Extract<ThoughtStep, { kind: 'tool' }>;
    expect(step.state).toBe('output-error');
    expect(step.errorText).toBe('boom');
    expect(tl.toolCount).toBe(1);
    expect(tl.isStreaming).toBe(false);
  });

  it('skips tool-invocation and empty tool names', () => {
    const tl = buildThoughtTimeline([
      { type: 'tool-invocation', toolCallId: 't1', state: 'input-available' },
      { type: 'tool-', toolCallId: 't2', state: 'input-available' },
    ]);
    expect(tl.steps).toHaveLength(0);
    expect(tl.toolCount).toBe(0);
  });

  it('counts distinct tool calls', () => {
    const tl = buildThoughtTimeline([
      { type: 'tool-web', toolCallId: 't1', state: 'output-available' },
      { type: 'tool-rag_search', toolCallId: 't2', state: 'output-available' },
      { type: 'tool-web', toolCallId: 't3', state: 'output-available' },
    ]);
    expect(tl.toolCount).toBe(3);
    expect(tl.steps).toHaveLength(3);
  });

  it('tolerates malformed entries', () => {
    const tl = buildThoughtTimeline([
      null,
      42,
      { noType: true },
      { type: 'reasoning', text: 'ok', state: 'done' },
    ] as unknown[]);
    expect(tl.steps).toHaveLength(1);
  });
});

describe('hasThoughtSteps (cheap predicate parity with buildThoughtTimeline)', () => {
  const cases: unknown[][] = [
    [],
    [{ type: 'text', text: 'answer' }],
    [{ type: 'step-start' }],
    [{ type: 'reasoning', text: 'x', state: 'done' }],
    [{ type: 'reasoning', text: '', state: 'done' }], // redacted still a step
    [{ type: 'tool-web', toolCallId: 't', state: 'output-available' }],
    [{ type: 'tool-invocation', toolCallId: 't', state: 'input-available' }], // skipped
    [{ type: 'tool-', toolCallId: 't', state: 'input-available' }], // skipped
    [
      { type: 'file', url: 'x' },
      { type: 'tool-rag_search', toolCallId: 't' },
    ],
  ];

  it('matches buildThoughtTimeline(...).steps.length > 0 for every shape', () => {
    for (const parts of cases) {
      expect(hasThoughtSteps(parts)).toBe(
        buildThoughtTimeline(parts).steps.length > 0,
      );
    }
  });

  it('returns false for undefined', () => {
    expect(hasThoughtSteps(undefined)).toBe(false);
  });
});
