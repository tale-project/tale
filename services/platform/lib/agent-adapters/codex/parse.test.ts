import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

import type { AgentEvent } from '../events';
import { CodexParser } from './parse';

// Captured from a real `codex exec --json` run (codex-cli 0.142.5) against an
// OpenAI Responses API mock; sanitized (host bash path only).
const FIXTURE = join(import.meta.dirname, '../fixtures/codex/shell-turn.jsonl');

function parseChunked(text: string, chunkSize: number): AgentEvent[] {
  const parser = new CodexParser();
  const events: AgentEvent[] = [];
  for (let i = 0; i < text.length; i += chunkSize) {
    events.push(...parser.feed(text.slice(i, i + chunkSize)));
  }
  events.push(...parser.end());
  return events;
}

function feedLines(lines: object[]): AgentEvent[] {
  const parser = new CodexParser();
  const events = parser.feed(
    lines.map((l) => JSON.stringify(l)).join('\n') + '\n',
  );
  events.push(...parser.end());
  return events;
}

describe('CodexParser', () => {
  const text = readFileSync(FIXTURE, 'utf8');

  it('maps the captured shell turn to normalized events', () => {
    const events = parseChunked(text, 10_000);

    expect(events[0]).toMatchObject({
      type: 'run-started',
      agent: 'codex',
      agentSessionId: '019f3b0c-4531-7313-877c-fd1078c809a4',
    });

    const toolUses = events.filter((e) => e.type === 'tool-use');
    expect(toolUses).toEqual([
      {
        type: 'tool-use',
        toolUseId: 'item_0',
        toolName: 'Bash',
        input: { command: "/bin/bash -lc 'echo hello-from-codex'" },
      },
    ]);

    const toolResults = events.filter((e) => e.type === 'tool-result');
    expect(toolResults).toEqual([
      {
        type: 'tool-result',
        toolUseId: 'item_0',
        isError: false,
        output: { output: 'hello-from-codex\n', exitCode: 0 },
      },
    ]);

    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', text: 'Done: printed hello-from-codex.' },
    ]);

    expect(events.filter((e) => e.type === 'usage')).toEqual([
      {
        type: 'usage',
        inputTokens: 320,
        outputTokens: 37,
        cacheReadTokens: 60,
      },
    ]);

    const result = events.find((e) => e.type === 'result');
    expect(result).toMatchObject({
      type: 'result',
      status: 'completed',
      agentSessionId: '019f3b0c-4531-7313-877c-fd1078c809a4',
      finalText: 'Done: printed hello-from-codex.',
    });
  });

  it('parses the fixture with pathological mid-line chunk splits', () => {
    for (const chunkSize of [1, 7, 13, 37, 256]) {
      const events = parseChunked(text, chunkSize);
      expect(events.some((e) => e.type === 'run-started')).toBe(true);
      expect(events.filter((e) => e.type === 'tool-use').length).toBe(1);
      expect(events.some((e) => e.type === 'result')).toBe(true);
    }
  });

  it('emits NO usage event for a zero-token turn', () => {
    const events = feedLines([
      { type: 'thread.started', thread_id: 't1' },
      { type: 'turn.started' },
      {
        type: 'turn.completed',
        usage: {
          input_tokens: 0,
          cached_input_tokens: 0,
          output_tokens: 0,
          reasoning_output_tokens: 0,
        },
      },
    ]);
    expect(events.filter((e) => e.type === 'usage')).toEqual([]);
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      type: 'result',
      status: 'completed',
    });
  });

  it('maps SDK-typed item kinds (mcp_tool_call, file_change, todo_list, web_search)', () => {
    // Shapes from the @openai/codex-sdk ThreadItem typings (versioned with the
    // pinned CLI).
    const events = feedLines([
      { type: 'thread.started', thread_id: 't2' },
      {
        type: 'item.started',
        item: {
          id: 'm1',
          type: 'mcp_tool_call',
          server: 'integrations',
          tool: 'dispatch',
          arguments: { slug: 'tavily', operation: 'search' },
          status: 'in_progress',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'm1',
          type: 'mcp_tool_call',
          server: 'integrations',
          tool: 'dispatch',
          arguments: { slug: 'tavily', operation: 'search' },
          error: { message: 'integration not connected' },
          status: 'failed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'f1',
          type: 'file_change',
          changes: [{ path: 'src/app.ts', kind: 'update' }],
          status: 'completed',
        },
      },
      {
        type: 'item.completed',
        item: {
          id: 'p1',
          type: 'todo_list',
          items: [{ text: 'write test', completed: false }],
        },
      },
      {
        type: 'item.completed',
        item: { id: 'w1', type: 'web_search', query: 'bun workspaces' },
      },
    ]);

    const uses = events.filter((e) => e.type === 'tool-use');
    expect(uses.map((e) => (e.type === 'tool-use' ? e.toolName : ''))).toEqual([
      'mcp__integrations__dispatch',
      'Edit',
      'TodoWrite',
      'WebSearch',
    ]);

    const mcpResult = events.find(
      (e) => e.type === 'tool-result' && e.toolUseId === 'm1',
    );
    expect(mcpResult).toMatchObject({
      type: 'tool-result',
      isError: true,
      output: { message: 'integration not connected' },
    });

    // file_change surfaced only as item.completed → tool-use synthesized.
    const fileResult = events.find(
      (e) => e.type === 'tool-result' && e.toolUseId === 'f1',
    );
    expect(fileResult).toMatchObject({ type: 'tool-result', isError: false });
  });

  it('maps turn.failed to an error + error result, and transient stream errors to raw', () => {
    const events = feedLines([
      { type: 'thread.started', thread_id: 't3' },
      { type: 'turn.started' },
      // Observed live: the CLI emits transient reconnect notices as `error`
      // events before the terminal turn.failed.
      { type: 'error', message: 'Reconnecting... 1/5 (stream disconnected)' },
      {
        type: 'turn.failed',
        error: { message: 'stream disconnected before completion' },
      },
    ]);
    expect(
      events
        .filter((e) => e.type === 'error')
        .map((e) => (e.type === 'error' ? e.message : '')),
    ).toEqual(['stream disconnected before completion']);
    expect(events.find((e) => e.type === 'result')).toMatchObject({
      type: 'result',
      status: 'error',
      isError: true,
      agentSessionId: 't3',
    });
    const raws = events.filter((e) => e.type === 'raw');
    expect(raws.length).toBeGreaterThan(0);
  });

  it('passes reasoning and unknown items through as raw (never dropped)', () => {
    const events = feedLines([
      { type: 'thread.started', thread_id: 't4' },
      {
        type: 'item.completed',
        item: { id: 'r1', type: 'reasoning', text: 'Considering options.' },
      },
      { type: 'some.future.event', payload: 1 },
    ]);
    expect(events.filter((e) => e.type === 'raw').length).toBe(2);
  });
});
