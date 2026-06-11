import { describe, it, expect } from 'vitest';

import { buildExternalAgentParts } from './build-external-agent-parts';
import { buildMessageSegments } from './build-message-segments';

// recentEvents are JSON-stringified AgentEvents, in chronological order.
const ev = (o: unknown) => JSON.stringify(o);

describe('buildExternalAgentParts', () => {
  it('returns [] for empty/undefined input', () => {
    expect(buildExternalAgentParts(undefined)).toEqual([]);
    expect(buildExternalAgentParts([])).toEqual([]);
  });

  it('maps text events to reasoning parts and skips blank ones', () => {
    const parts = buildExternalAgentParts([
      ev({ type: 'text', text: 'Let me clone the repo.' }),
      ev({ type: 'text', text: '   ' }),
    ]);
    expect(parts).toEqual([
      { type: 'reasoning', text: 'Let me clone the repo.', state: 'done' },
    ]);
  });

  it('maps tool-use to an input-available tool part with input', () => {
    const parts = buildExternalAgentParts([
      ev({
        type: 'tool-use',
        toolUseId: 't1',
        toolName: 'Bash',
        input: { command: 'gh repo clone' },
      }),
    ]);
    expect(parts).toEqual([
      {
        type: 'tool-Bash',
        state: 'input-available',
        toolCallId: 't1',
        input: { command: 'gh repo clone' },
      },
    ]);
  });

  it('updates the matching tool part to output-available on tool-result', () => {
    const parts = buildExternalAgentParts([
      ev({ type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} }),
      ev({
        type: 'tool-result',
        toolUseId: 't1',
        output: 'ok',
        isError: false,
      }),
    ]);
    expect(parts).toHaveLength(1);
    expect(parts[0]).toMatchObject({
      type: 'tool-Bash',
      toolCallId: 't1',
      state: 'output-available',
      output: 'ok',
    });
  });

  it('marks errored results output-error with errorText', () => {
    const parts = buildExternalAgentParts([
      ev({ type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} }),
      ev({
        type: 'tool-result',
        toolUseId: 't1',
        output: 'boom',
        isError: true,
      }),
    ]);
    expect(parts[0]).toMatchObject({
      state: 'output-error',
      errorText: 'boom',
    });
  });

  it('ignores deltas/usage/raw/result/run-started and bad JSON', () => {
    const parts = buildExternalAgentParts([
      ev({ type: 'run-started', agent: 'claude-code' }),
      ev({ type: 'text-delta', text: 'x' }),
      ev({ type: 'usage', inputTokens: 1, outputTokens: 2 }),
      ev({ type: 'raw', agent: 'claude-code', payload: {} }),
      ev({ type: 'result', status: 'completed' }),
      'not json{',
    ]);
    expect(parts).toEqual([]);
  });

  it('produces parts the existing segments builder consumes', () => {
    const parts = buildExternalAgentParts([
      ev({ type: 'text', text: 'Reading the issue.' }),
      ev({ type: 'tool-use', toolUseId: 't1', toolName: 'Bash', input: {} }),
      ev({
        type: 'tool-result',
        toolUseId: 't1',
        output: 'done',
        isError: false,
      }),
    ]);
    const { segments, toolCount } = buildMessageSegments(parts);
    expect(segments).toHaveLength(2); // 1 reasoning + 1 tool (merged)
    expect(toolCount).toBe(1);
    const tool = segments.find((s) => s.kind === 'tool');
    expect(tool).toMatchObject({ toolName: 'Bash', state: 'output-available' });
  });
});
