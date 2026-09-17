// claude-stream-json family tests. Parser expectations are derived from the
// captured streams in fixtures/claude-code/ (issue-to-pr + subagent-turn use
// the Agent-SDK shapes; plan-mode-turn, empty-answer-turn, token-only-turn
// and thinking-only-turn are real pinned-CLI 2.1.173 captures); the
// stdin-dialect tests pin the steer payload builders the family also owns. Exec construction is covered by the golden fixtures +
// interpreter tests, not here.

import { describe, expect, it } from 'vitest';

import { collectEvents, readFixture } from '../test-helpers';
import {
  buildSteerStdinPayload,
  createParser,
  STEER_STDIN_TEXT_CAP,
  truncateToUtf8Bytes,
} from './claude-stream-json';

describe('claude-stream-json parser', () => {
  it('normalizes the issue-to-pr stream (usage deduped by message id)', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'issue-to-pr'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'claude-code',
        sessionId: 'sess-abc',
        model: 'claude-sonnet-4-6',
      },
      { type: 'text-delta', text: 'Reading ' },
      { type: 'text-delta', text: 'the issue.' },
      { type: 'text', text: "I'll implement the fix." },
      {
        type: 'tool-use',
        toolUseId: 'tu_1',
        toolName: 'Bash',
        input: { command: 'git checkout -b fix/issue-1' },
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 1200,
        outputTokens: 45,
        cacheReadTokens: 800,
        cacheWriteTokens: 0,
      },
      // Second assistant event repeats message id msg_1 — its usage is
      // deduped, only the tool_use block surfaces.
      {
        type: 'tool-use',
        toolUseId: 'tu_2',
        toolName: 'Read',
        input: { file_path: 'src/app.ts' },
      },
      {
        type: 'tool-result',
        toolUseId: 'tu_1',
        output: 'Switched to a new branch',
        isError: false,
      },
      {
        type: 'tool-use',
        toolUseId: 'tu_3',
        toolName: 'Bash',
        input: { command: 'gh pr create' },
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 1500,
        outputTokens: 30,
        cacheReadTokens: 1200,
        cacheWriteTokens: 0,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'sess-abc',
        finalText: 'Opened PR https://github.com/org/repo/pull/7',
        durationMs: 42000,
        usageTotals: {
          inputTokens: 0,
          outputTokens: 0,
          costEstimateUsd: 0.0123,
        },
      },
    ]);
  });

  it('marks sub-agent events with the parent task tool_use id', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'subagent-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'claude-code',
        sessionId: 'sess-sub',
        model: 'claude-sonnet-4-6',
      },
      { type: 'text', text: "I'll launch a research sub-agent." },
      {
        type: 'tool-use',
        toolUseId: 'tu_task1',
        toolName: 'Task',
        input: {
          description: 'Research frameworks',
          prompt: 'Survey agent frameworks',
        },
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 1000,
        outputTokens: 40,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      {
        type: 'text',
        text: 'Running 5 parallel searches now.',
        parentToolUseId: 'tu_task1',
      },
      {
        type: 'tool-use',
        toolUseId: 'tu_ws1',
        toolName: 'WebSearch',
        input: { query: 'agent frameworks 2026' },
        parentToolUseId: 'tu_task1',
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 500,
        outputTokens: 20,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        parentToolUseId: 'tu_task1',
      },
      {
        type: 'tool-result',
        toolUseId: 'tu_ws1',
        output: 'Found: LangChain, CrewAI, AutoGen',
        isError: false,
        parentToolUseId: 'tu_task1',
      },
      {
        type: 'text',
        text: '## Frameworks Report\n\nLangChain leads adoption; CrewAI is fastest to prototype.',
        parentToolUseId: 'tu_task1',
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 700,
        outputTokens: 120,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        parentToolUseId: 'tu_task1',
      },
      // The parent task settles as a MAIN-agent tool_result
      // (parent_tool_use_id null on the wire → no field).
      {
        type: 'tool-result',
        toolUseId: 'tu_task1',
        output:
          '## Frameworks Report\n\nLangChain leads adoption; CrewAI is fastest to prototype.',
        isError: false,
      },
      {
        type: 'text',
        text: "Done — the sub-agent's report is summarized above.",
      },
      {
        type: 'usage',
        model: 'claude-sonnet-4-6',
        inputTokens: 1800,
        outputTokens: 60,
        cacheReadTokens: 1000,
        cacheWriteTokens: 0,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'sess-sub',
        finalText: "Done — the sub-agent's report is summarized above.",
        durationMs: 30000,
        usageTotals: { inputTokens: 0, outputTokens: 0, costEstimateUsd: 0.02 },
      },
    ]);
  });

  it('normalizes the real plan-mode capture (top-level init model, denied ExitPlanMode)', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'plan-mode-turn'),
    );
    expect(events).toEqual([
      // The pinned CLI reports the model at the TOP level of init (no
      // `data` envelope) — it must still reach turn-started.
      {
        type: 'turn-started',
        harness: 'claude-code',
        sessionId: 'a452cac8-c9d7-43cd-867d-4fee432973a3',
        model: 'openrouter/anthropic/claude-haiku-4.5',
      },
      {
        type: 'tool-use',
        toolUseId: 'toolu_bdrk_01V5MDeaMj3L896kKRkWRetL',
        toolName: 'ExitPlanMode',
        input: {
          plan: expect.stringContaining('# Plan: Create hello.txt'),
          planFilePath:
            '/workspace/.home/.claude/plans/create-a-file-hello-txt-snazzy-gizmo.md',
        },
      },
      {
        type: 'usage',
        model: 'anthropic/claude-4.5-haiku-20251001',
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      // The plan-approval denial rides a tool_result with is_error true.
      {
        type: 'tool-result',
        toolUseId: 'toolu_bdrk_01V5MDeaMj3L896kKRkWRetL',
        output: 'Exit plan mode?',
        isError: true,
      },
      // The turn's own totals come from the result: the streamed assistant
      // event above carries only the call's opening stamp (0/0 here).
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'a452cac8-c9d7-43cd-867d-4fee432973a3',
        finalText: expect.stringContaining('Plan created.'),
        isError: false,
        durationMs: 14144,
        usageTotals: {
          inputTokens: 66200,
          outputTokens: 483,
          costEstimateUsd: 0.343075,
        },
      },
    ]);
  });

  it('normalizes a real empty answer: a clean end with nothing from the model', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'empty-answer-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'claude-code',
        sessionId: '1ada8c8a-113e-4b8b-b46c-b3a1c23c12c6',
        model: 'claude-sonnet-4-5',
      },
      {
        type: 'raw',
        harness: 'claude-code',
        payload: expect.objectContaining({ subtype: 'status' }),
      },
      // No text, no tool call, no usage event: the CLI wrote no assistant
      // message at all. An empty `result` sets no finalText.
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: '1ada8c8a-113e-4b8b-b46c-b3a1c23c12c6',
        isError: false,
        durationMs: 51,
        usageTotals: { inputTokens: 0, outputTokens: 0, costEstimateUsd: 0 },
      },
    ]);
  });

  it('counts the output tokens of an answer that shows nothing', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'token-only-turn'),
    );
    expect(events.at(-1)).toEqual({
      type: 'turn-ended',
      status: 'completed',
      sessionId: '30a5f2b2-9eb7-499d-8c79-f69732092059',
      isError: false,
      durationMs: 31,
      usageTotals: {
        inputTokens: 0,
        outputTokens: 1,
        costEstimateUsd: 0.000014999999999999999,
      },
    });
    expect(events.map((event) => event.type)).toEqual([
      'turn-started',
      'raw',
      'turn-ended',
    ]);
  });

  it('counts a reasoning-only answer from the result, not the streamed stamp', () => {
    const events = collectEvents(
      createParser('claude-code'),
      readFixture('claude-code', 'thinking-only-turn'),
    );
    expect(events).toEqual([
      {
        type: 'turn-started',
        harness: 'claude-code',
        sessionId: 'bfb0924a-8989-48f4-8ca9-8bab2d0290d9',
        model: 'claude-sonnet-4-5',
      },
      {
        type: 'raw',
        harness: 'claude-code',
        payload: expect.objectContaining({ subtype: 'status' }),
      },
      {
        type: 'raw',
        harness: 'claude-code',
        payload: expect.objectContaining({ subtype: 'thinking_tokens' }),
      },
      // The thinking block itself surfaces nothing; its message's usage is
      // the opening stamp, which says 0.
      {
        type: 'usage',
        model: 'claude-sonnet-4-5',
        inputTokens: 50,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
      },
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'bfb0924a-8989-48f4-8ca9-8bab2d0290d9',
        isError: false,
        durationMs: 53,
        usageTotals: {
          inputTokens: 50,
          outputTokens: 30,
          costEstimateUsd: 0.0006000000000000001,
        },
      },
    ]);
  });

  it.each([
    'issue-to-pr',
    'subagent-turn',
    'plan-mode-turn',
    'empty-answer-turn',
    'token-only-turn',
    'thinking-only-turn',
  ])('parses %s identically when fed in 7-byte chunks', (name) => {
    const text = readFixture('claude-code', name);
    expect(collectEvents(createParser('claude-code'), text, 7)).toEqual(
      collectEvents(createParser('claude-code'), text),
    );
  });

  it('classifies an API-errored result reported under subtype success', () => {
    // The CLI leaves subtype:'success' on a result that actually failed with
    // an API error — is_error + api_error_status carry the truth.
    const line = `${JSON.stringify({
      type: 'result',
      subtype: 'success',
      is_error: true,
      api_error_status: 429,
      session_id: 'sess-err',
    })}\n`;
    expect(collectEvents(createParser('claude-code'), line)).toEqual([
      {
        type: 'turn-ended',
        status: 'completed',
        sessionId: 'sess-err',
        isError: true,
        apiErrorStatus: 429,
      },
    ]);
  });

  it('maps error_max_turns to the max-turns status', () => {
    const line = `${JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
    })}\n`;
    expect(collectEvents(createParser('claude-code'), line)).toEqual([
      { type: 'turn-ended', status: 'max-turns' },
    ]);
  });

  it('balances the background-task ledger across all three system shapes', () => {
    const lines = [
      {
        type: 'system',
        subtype: 'task_started',
        task_id: 'bg1',
        description: 'dev server',
      },
      {
        type: 'system',
        subtype: 'task_notification',
        task_id: 'bg1',
        status: 'completed',
      },
      // task_updated settles ONLY on a terminal patch status.
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'bg2',
        patch: { status: 'running' },
      },
      {
        type: 'system',
        subtype: 'task_updated',
        task_id: 'bg2',
        patch: { status: 'killed' },
      },
    ]
      .map((l) => JSON.stringify(l))
      .join('\n');
    const events = collectEvents(createParser('claude-code'), `${lines}\n`);
    expect(events).toEqual([
      { type: 'task-started', taskId: 'bg1', description: 'dev server' },
      { type: 'task-settled', taskId: 'bg1', status: 'completed' },
      // The non-terminal patch surfaces as raw (observability), never as a
      // settle.
      {
        type: 'raw',
        harness: 'claude-code',
        payload: {
          type: 'system',
          subtype: 'task_updated',
          task_id: 'bg2',
          patch: { status: 'running' },
        },
      },
      { type: 'task-settled', taskId: 'bg2', status: 'killed' },
    ]);
  });

  it('surfaces a steer-hook injection and passes unknown events as raw', () => {
    const steer = {
      type: 'user',
      message: {
        content: [
          {
            type: 'text',
            text: 'Stop hook feedback:\n[TALE_STEER ids=m1,m2] The user sent…',
          },
        ],
      },
    };
    const unknown = { type: 'brand_new_event', payload: { x: 1 } };
    const apiRetry = { type: 'system', subtype: 'api_retry', attempt: 1 };
    const text = `${[steer, unknown, apiRetry]
      .map((l) => JSON.stringify(l))
      .join('\n')}\n`;
    expect(collectEvents(createParser('claude-code'), text)).toEqual([
      {
        type: 'steer-injected',
        messageIds: ['m1', 'm2'],
        text: 'Stop hook feedback:\n[TALE_STEER ids=m1,m2] The user sent…',
      },
      { type: 'raw', harness: 'claude-code', payload: unknown },
      { type: 'raw', harness: 'claude-code', payload: apiRetry },
    ]);
  });
});

describe('claude-stream-json steer stdin helpers', () => {
  it('wraps a steer batch in one sentinel-tagged user-message line', () => {
    const line = buildSteerStdinPayload([
      { messageId: 'm1', text: 'Also update the docs.' },
      { messageId: 'm2', text: 'And bump the version.' },
    ]);
    expect(line.endsWith('\n')).toBe(true);
    const parsed = JSON.parse(line);
    const text: string = parsed.message.content[0].text;
    expect(text.startsWith('[TALE_STEER ids=m1,m2]')).toBe(true);
    expect(text).toContain('Also update the docs.');
    expect(text).toContain('And bump the version.');
  });

  it('caps the steer text by BYTES without splitting a codepoint', () => {
    expect(truncateToUtf8Bytes('hello', 10)).toBe('hello');
    // 'ab' (2 bytes) + 🙂 (4 bytes): a 5-byte cap must back off to 'ab'
    // rather than emit half an emoji.
    expect(truncateToUtf8Bytes('ab🙂', 5)).toBe('ab');
    const bigRow = [{ messageId: 'm1', text: '🙂'.repeat(10_000) }];
    const parsed = JSON.parse(buildSteerStdinPayload(bigRow));
    const bytes = new TextEncoder().encode(parsed.message.content[0].text);
    expect(bytes.length).toBeLessThanOrEqual(STEER_STDIN_TEXT_CAP);
  });
});
