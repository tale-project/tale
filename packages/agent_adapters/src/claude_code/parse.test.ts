import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { isRecord } from '../jsonl';
import { ClaudeCodeParser } from './parse';

const FIXTURE = join(
  import.meta.dirname,
  '../../fixtures/claude_code/issue-to-pr.jsonl',
);
const PLAN_FIXTURE = join(
  import.meta.dirname,
  '../../fixtures/claude_code/plan-mode-turn.jsonl',
);
const SUBAGENT_FIXTURE = join(
  import.meta.dirname,
  '../../fixtures/claude_code/subagent-turn.jsonl',
);

/** Feed a fixture through the parser in arbitrary byte-sized chunks so the
 * test exercises mid-line splits (the JSONL reassembler's whole job). */
function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new ClaudeCodeParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

describe('ClaudeCodeParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the full issue→PR stream to normalized events', () => {
    const events = parseChunked(text, 10_000);

    const started = events.find((e) => e.type === 'run-started');
    expect(started).toMatchObject({
      type: 'run-started',
      agent: 'claude-code',
      agentSessionId: 'sess-abc',
      model: 'claude-sonnet-4-6',
    });

    // text-delta reassembled across two delta events.
    const deltas = events
      .filter((e) => e.type === 'text-delta')
      .map((e) => (e.type === 'text-delta' ? e.text : ''));
    expect(deltas.join('')).toBe('Reading the issue.');

    // tool-use / tool-result.
    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(
      toolUses.map((e) => (e.type === 'tool-use' ? e.toolName : '')),
    ).toEqual(['Bash', 'Read', 'Bash']);
    const toolResult = events.find((e) => e.type === 'tool-result');
    expect(toolResult).toMatchObject({ toolUseId: 'tu_1', isError: false });

    // result terminal event.
    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: 'sess-abc',
      durationMs: 42_000,
    });
    expect(
      result?.type === 'result' ? result.usageTotals?.costEstimateUsd : 0,
    ).toBe(0.0123);
  });

  it('dedupes usage by message id (parallel tool use shares an id)', () => {
    const events = parseChunked(text, 10_000);
    const usage = events.filter((e) => e.type === 'usage');
    // Two distinct message ids (msg_1, msg_2) → exactly two usage events,
    // even though msg_1 appears on two assistant lines.
    expect(usage).toHaveLength(2);
    const first = usage[0];
    expect(first?.type === 'usage' ? first.inputTokens : 0).toBe(1200);
    expect(first?.type === 'usage' ? first.cacheReadTokens : 0).toBe(800);
  });

  it('is robust to mid-line chunk splits', () => {
    const whole = parseChunked(text, 10_000);
    for (const size of [1, 3, 7, 64]) {
      expect(parseChunked(text, size)).toEqual(whole);
    }
  });

  it('forwards unmapped system events as raw', () => {
    const parser = new ClaudeCodeParser();
    const events = parser.feed(
      `${JSON.stringify({ type: 'system', subtype: 'api_retry', attempt: 1 })}\n`,
    );
    expect(events[0]).toMatchObject({ type: 'raw', agent: 'claude-code' });
  });

  it('ignores malformed JSON lines without throwing', () => {
    const parser = new ClaudeCodeParser();
    expect(parser.feed('{not json\n')).toEqual([]);
  });

  it('maps a steer-hook injection user event to steer-injected', () => {
    // Real shape from CLI 2.1.173: a Stop-hook decision:block surfaces as a
    // synthetic user message "Stop hook feedback:\n<reason>".
    const parser = new ClaudeCodeParser();
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [
          {
            type: 'text',
            text: 'Stop hook feedback:\n[TALE_STEER ids=m1,m2] The user sent the following message(s) while you were working. Adjust your current work to incorporate them now:\n\nalso add tests',
          },
        ],
      },
    });
    const events = parser.feed(`${line}\n`);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: 'steer-injected',
      messageIds: ['m1', 'm2'],
    });
  });

  it('drops user text blocks without the steer sentinel (previous behavior)', () => {
    const parser = new ClaudeCodeParser();
    const line = JSON.stringify({
      type: 'user',
      message: {
        role: 'user',
        content: [{ type: 'text', text: 'plain synthetic user text' }],
      },
    });
    expect(parser.feed(`${line}\n`)).toEqual([]);
  });

  it('surfaces an ExitPlanMode plan turn (recorded from CLI 2.1.173 headless)', () => {
    // Fixture is a real `-p --permission-mode plan` run: the proposed plan
    // rides the tool_use input (input.plan + planFilePath) and the call is
    // denied ("Exit plan mode?", is_error) — the platform's plan capture
    // reads the input; the turn still ends as a successful result.
    const planText = readFileSync(PLAN_FIXTURE, 'utf8');
    const events = parseChunked(planText, 1_000);

    const toolUse = events.find(
      (e) => e.type === 'tool-use' && e.toolName === 'ExitPlanMode',
    );
    expect(toolUse).toBeDefined();
    const input =
      toolUse?.type === 'tool-use' && isRecord(toolUse.input)
        ? toolUse.input
        : undefined;
    expect(input?.plan).toMatch(/^# Plan: Create hello.txt/);
    expect(input?.planFilePath).toContain('/plans/');

    const denial = events.find(
      (e) =>
        e.type === 'tool-result' &&
        toolUse?.type === 'tool-use' &&
        e.toolUseId === toolUse.toolUseId,
    );
    expect(denial).toMatchObject({ type: 'tool-result', isError: true });

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({ type: 'result', status: 'completed' });
  });

  it('maps the background-task ledger events (recorded from CLI 2.1.173)', () => {
    // Shapes captured live: task_started opens a ledger entry,
    // task_notification (status completed|stopped) settles it.
    const parser = new ClaudeCodeParser();
    const started = JSON.stringify({
      type: 'system',
      subtype: 'task_started',
      task_id: 'b30iiqn5g',
      tool_use_id: 'toolu_01X',
      description: 'sleep 90',
      task_type: 'local_bash',
      session_id: 's-1',
    });
    const settled = JSON.stringify({
      type: 'system',
      subtype: 'task_notification',
      task_id: 'b30iiqn5g',
      tool_use_id: 'toolu_01X',
      status: 'stopped',
      output_file: '',
      summary: 'sleep 90',
      session_id: 's-1',
    });
    expect(parser.feed(`${started}\n`)).toEqual([
      { type: 'task-started', taskId: 'b30iiqn5g', description: 'sleep 90' },
    ]);
    expect(parser.feed(`${settled}\n`)).toEqual([
      { type: 'task-settled', taskId: 'b30iiqn5g', status: 'stopped' },
    ]);
  });

  it('attaches parentToolUseId to sub-agent events and omits it for the main agent', () => {
    const subText = readFileSync(SUBAGENT_FIXTURE, 'utf8');
    const events = parseChunked(subText, 1_000);

    // The main agent launches the sub-agent via the Task tool — no parent.
    const taskUse = events.find(
      (e) => e.type === 'tool-use' && e.toolName === 'Task',
    );
    expect(taskUse).toMatchObject({ type: 'tool-use', toolUseId: 'tu_task1' });
    expect(
      taskUse?.type === 'tool-use' ? taskUse.parentToolUseId : 'x',
    ).toBeUndefined();

    // The sub-agent's WebSearch call carries the parent Task's id.
    const subUse = events.find(
      (e) => e.type === 'tool-use' && e.toolName === 'WebSearch',
    );
    expect(subUse).toMatchObject({
      type: 'tool-use',
      toolUseId: 'tu_ws1',
      parentToolUseId: 'tu_task1',
    });

    // The sub-agent's tool result is tagged too.
    const subResult = events.find(
      (e) => e.type === 'tool-result' && e.toolUseId === 'tu_ws1',
    );
    expect(subResult).toMatchObject({
      type: 'tool-result',
      parentToolUseId: 'tu_task1',
    });

    // The Task's own result (the sub-agent's report) belongs to the main agent.
    const taskResult = events.find(
      (e) => e.type === 'tool-result' && e.toolUseId === 'tu_task1',
    );
    expect(
      taskResult?.type === 'tool-result' ? taskResult.parentToolUseId : 'x',
    ).toBeUndefined();

    // Sub-agent text carries the parent; main-agent text does not.
    const texts = events.filter((e) => e.type === 'text');
    const subNarration = texts.find(
      (e) => e.type === 'text' && e.text.startsWith('Running 5'),
    );
    expect(
      subNarration?.type === 'text' ? subNarration.parentToolUseId : undefined,
    ).toBe('tu_task1');
    const mainText = texts.find(
      (e) => e.type === 'text' && e.text.startsWith("I'll launch"),
    );
    expect(
      mainText?.type === 'text' ? mainText.parentToolUseId : 'x',
    ).toBeUndefined();
  });

  it('meters sub-agent usage (distinct message ids are real token spend)', () => {
    const subText = readFileSync(SUBAGENT_FIXTURE, 'utf8');
    const events = parseChunked(subText, 1_000);
    // Four distinct message ids → four usage events (main×2 + sub×2); a
    // sub-agent message has its own id and its tokens are genuine spend.
    const usage = events.filter((e) => e.type === 'usage');
    expect(usage).toHaveLength(4);
    // Sub-agent usage carries the parent Task id so the drain doesn't read it
    // as main-loop activity (quiet-idle detection during delegation); main-agent
    // usage has none.
    const withParent = usage.filter(
      (e) => e.type === 'usage' && e.parentToolUseId === 'tu_task1',
    );
    const withoutParent = usage.filter(
      (e) => e.type === 'usage' && e.parentToolUseId === undefined,
    );
    expect(withParent).toHaveLength(2);
    expect(withoutParent).toHaveLength(2);
  });

  it('tags a streamed text-delta with the parent Task id when it is a sub-agent', () => {
    const parser = new ClaudeCodeParser();
    const subDelta = JSON.stringify({
      type: 'stream_event',
      parent_tool_use_id: 'tu_task1',
      event: { delta: { type: 'text_delta', text: 'sub thinking' } },
    });
    const mainDelta = JSON.stringify({
      type: 'stream_event',
      event: { delta: { type: 'text_delta', text: 'main thinking' } },
    });
    const events = [
      ...parser.feed(`${subDelta}\n`),
      ...parser.feed(`${mainDelta}\n`),
    ];
    const sub = events.find(
      (e) => e.type === 'text-delta' && e.text === 'sub thinking',
    );
    const main = events.find(
      (e) => e.type === 'text-delta' && e.text === 'main thinking',
    );
    expect(sub?.type === 'text-delta' ? sub.parentToolUseId : 'x').toBe(
      'tu_task1',
    );
    expect(
      main?.type === 'text-delta' ? main.parentToolUseId : 'x',
    ).toBeUndefined();
  });

  it('handles a second init (model re-invoked after a background task)', () => {
    // In stream-json input mode the process emits a fresh `system init` when
    // a settled background task re-invokes the model — must map to another
    // run-started, not break the parser.
    const parser = new ClaudeCodeParser();
    const init = JSON.stringify({
      type: 'system',
      subtype: 'init',
      session_id: 's-1',
      data: { model: 'claude-sonnet-4-6' },
    });
    expect(parser.feed(`${init}\n`)).toHaveLength(1);
    expect(parser.feed(`${init}\n`)).toEqual([
      {
        type: 'run-started',
        agent: 'claude-code',
        agentSessionId: 's-1',
        model: 'claude-sonnet-4-6',
      },
    ]);
  });
});
