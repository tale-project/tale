// opencode-jsonl family tests. Parser expectations derive from the two
// captured fixtures/opencode/ streams. Exec construction is covered by the
// golden fixtures + interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import { createParser } from './opencode-jsonl';

describe('opencode-jsonl parser', () => {
  it('normalizes the issue-to-pr stream (per-step usage, terminal stop)', () => {
    const events = collectEvents(
      createParser('opencode'),
      readFixture('opencode', 'issue-to-pr'),
    );
    expect(events).toEqual([
      { type: 'turn-started', harness: 'opencode', sessionId: 'ses_xyz' },
      { type: 'text', text: 'Implementing the fix.' },
      {
        type: 'tool-use',
        toolUseId: 'call_1',
        toolName: 'bash',
        input: { command: 'git checkout -b fix/issue-1' },
      },
      {
        type: 'tool-result',
        toolUseId: 'call_1',
        output: 'Switched to a new branch',
      },
      // call_2 surfaces straight in the error state — the result still
      // pairs by id even though no running phase was seen.
      {
        type: 'tool-result',
        toolUseId: 'call_2',
        output: 'file not found',
        isError: true,
      },
      // Mid-run step_finish (reason tool-calls): usage only, no turn end.
      {
        type: 'usage',
        inputTokens: 900,
        outputTokens: 50,
        cacheReadTokens: 500,
        cacheWriteTokens: 0,
        costEstimateUsd: 0.0042,
      },
      { type: 'text', text: 'Opening the PR.' },
      {
        type: 'usage',
        inputTokens: 1100,
        outputTokens: 55,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
        costEstimateUsd: 0.0061,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'ses_xyz',
        finalText: 'Opening the PR.',
        usageTotals: {
          inputTokens: 1100,
          outputTokens: 55,
          costEstimateUsd: 0.0061,
        },
      },
    ]);
  });

  it('normalizes the simple-turn stream', () => {
    const events = collectEvents(
      createParser('opencode'),
      readFixture('opencode', 'simple-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'opencode',
        sessionId: 'ses_0c666f713ffeSANITIZED0001',
      },
      { type: 'text', text: 'Mock turn complete: 2 + 2 = 4.' },
      {
        type: 'usage',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costEstimateUsd: 0,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'ses_0c666f713ffeSANITIZED0001',
        finalText: 'Mock turn complete: 2 + 2 = 4.',
        usageTotals: { inputTokens: 0, outputTokens: 0, costEstimateUsd: 0 },
      },
    ]);
  });

  it.each(['issue-to-pr', 'simple-turn'])(
    'parses %s identically when fed in 7-byte chunks',
    (name) => {
      const text = readFixture('opencode', name);
      expect(collectEvents(createParser('opencode'), text, 7)).toEqual(
        collectEvents(createParser('opencode'), text),
      );
    },
  );

  it('maps the error envelope and keeps id-less tool events as raw', () => {
    const noId = { type: 'tool_use', part: { tool: 'bash', state: {} } };
    const unknown = { type: 'novel_opencode_event', q: 4 };
    const text = `${[
      {
        type: 'error',
        error: { name: 'UnknownError', data: { message: 'provider down' } },
      },
      noId,
      unknown,
    ]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    const events = collectEvents(createParser('opencode'), text);
    expect(events[0]).toMatchObject({
      type: 'error',
      message: 'provider down',
    });
    // The id-less tool event seeds the turn, then passes through raw.
    expect(events[1]).toEqual({ type: 'turn-started', harness: 'opencode' });
    expect(events[2]).toEqual({
      type: 'raw',
      harness: 'opencode',
      payload: noId,
    });
    expect(events[3]).toEqual({
      type: 'raw',
      harness: 'opencode',
      payload: unknown,
    });
  });
});
