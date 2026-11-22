import { describe, expect, it } from 'vitest';

import type { UpstreamEndpoint } from '../endpoint.ts';
import type { RelayCallOutcome, UpstreamFetch } from '../passthrough.ts';
import { relayTranslated } from './relay.ts';

/**
 * Whole calls through the real adapters and the real provider packages,
 * against an upstream that answers as the vendor does: the pairs a harness
 * and its connector form when their wires differ.
 */

const sse = (event: Record<string, unknown>) =>
  `event: ${String(event.type)}\ndata: ${JSON.stringify(event)}\n\n`;

/** Claude thinking, signing its thinking, then calling a tool. */
const CLAUDE_THINKS_THEN_CALLS = [
  sse({
    type: 'message_start',
    message: {
      id: 'msg_01',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 50, output_tokens: 1 },
    },
  }),
  sse({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '', signature: '' },
  }),
  sse({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'I should list the files.' },
  }),
  sse({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'EqQBsig-from-anthropic' },
  }),
  sse({ type: 'content_block_stop', index: 0 }),
  sse({
    type: 'content_block_start',
    index: 1,
    content_block: {
      type: 'tool_use',
      id: 'toolu_01',
      name: 'bash',
      input: {},
    },
  }),
  sse({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'input_json_delta', partial_json: '{"command":"ls"}' },
  }),
  sse({ type: 'content_block_stop', index: 1 }),
  sse({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use', stop_sequence: null },
    usage: { output_tokens: 30 },
  }),
  sse({ type: 'message_stop' }),
].join('');

const CLAUDE_ANSWERS = [
  sse({
    type: 'message_start',
    message: {
      id: 'msg_02',
      type: 'message',
      role: 'assistant',
      model: 'claude-sonnet-5-5',
      content: [],
      stop_reason: null,
      usage: { input_tokens: 90, output_tokens: 1 },
    },
  }),
  sse({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }),
  sse({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'text_delta', text: 'Two files.' },
  }),
  sse({ type: 'content_block_stop', index: 0 }),
  sse({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn', stop_sequence: null },
    usage: { output_tokens: 4 },
  }),
  sse({ type: 'message_stop' }),
].join('');

const ANTHROPIC: UpstreamEndpoint = {
  wire: 'anthropic',
  connector: 'anthropic',
  modelId: 'claude-sonnet-5-5',
  baseUrl: 'https://api.anthropic.com',
  apiKey: 'sk-ant-org',
  headers: {},
};

/** A Chat Completions stream, folded the way pi folds it into the
 * assistant message it sends back next turn. */
function foldChatStream(text: string): Record<string, unknown> {
  const message: Record<string, unknown> = { role: 'assistant', content: '' };
  const calls: Record<
    number,
    { id: string; type: string; function: { name: string; arguments: string } }
  > = {};
  const details: unknown[] = [];
  for (const block of text.split('\n\n')) {
    const data = block.startsWith('data: ') ? block.slice(6) : '';
    if (data === '' || data === '[DONE]') continue;
    const chunk = JSON.parse(data) as {
      choices?: {
        delta?: {
          content?: string;
          tool_calls?: {
            index: number;
            id?: string;
            function?: { name?: string; arguments?: string };
          }[];
          reasoning_details?: unknown[];
        };
      }[];
    };
    const delta = chunk.choices?.[0]?.delta;
    if (delta === undefined) continue;
    if (typeof delta.content === 'string') {
      message.content = `${String(message.content)}${delta.content}`;
    }
    for (const call of delta.tool_calls ?? []) {
      const existing = calls[call.index] ?? {
        id: call.id ?? '',
        type: 'function',
        function: { name: '', arguments: '' },
      };
      if (call.id !== undefined) existing.id = call.id;
      if (call.function?.name !== undefined)
        existing.function.name = call.function.name;
      if (call.function?.arguments !== undefined) {
        existing.function.arguments += call.function.arguments;
      }
      calls[call.index] = existing;
    }
    details.push(...(delta.reasoning_details ?? []));
  }
  const toolCalls = Object.values(calls);
  if (toolCalls.length > 0) message.tool_calls = toolCalls;
  // pi sends the entries back in place of the reasoning text.
  if (details.length > 0) message.reasoning_details = details;
  return message;
}

describe('pi on a Claude model', () => {
  it('reads Claude’s tool call as a Chat Completions stream, and its next step carries Claude’s thinking back [RELAY-R7]', async () => {
    const sent: Record<string, unknown>[] = [];
    const answers = [CLAUDE_THINKS_THEN_CALLS, CLAUDE_ANSWERS];
    const fetcher: UpstreamFetch = async (_url, init) => {
      sent.push(
        JSON.parse(typeof init.body === 'string' ? init.body : '{}') as Record<
          string,
          unknown
        >,
      );
      return new Response(answers[sent.length - 1], {
        headers: { 'content-type': 'text/event-stream' },
      });
    };
    const outcomes: RelayCallOutcome[] = [];
    const tools = [
      {
        type: 'function',
        function: {
          name: 'bash',
          description: 'Run a command',
          parameters: {
            type: 'object',
            properties: { command: { type: 'string' } },
          },
        },
      },
    ];
    const first = {
      model: 'anthropic/claude-sonnet-5-5',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 'You are pi.' },
        { role: 'user', content: 'What is here?' },
      ],
      tools,
    };

    const answer = await relayTranslated({
      inbound: 'openai-chat',
      endpoint: ANTHROPIC,
      body: first,
      stream: true,
      requestedModel: first.model,
      signal: new AbortController().signal,
      onDone: (outcome) => outcomes.push(outcome),
      fetcher,
    });
    const assistant = foldChatStream(await answer.text());

    expect(assistant.tool_calls).toEqual([
      {
        id: 'toolu_01',
        type: 'function',
        function: { name: 'bash', arguments: '{"command":"ls"}' },
      },
    ]);
    expect(outcomes[0]).toMatchObject({
      status: 'completed',
      usage: { inputTokens: 50, outputTokens: 30 },
      estimated: false,
    });
    // The first request reached Claude in its own wire.
    expect(sent[0]).toMatchObject({
      model: 'claude-sonnet-5-5',
      system: [{ type: 'text', text: 'You are pi.' }],
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'What is here?' }] },
      ],
      stream: true,
    });

    const second = {
      ...first,
      messages: [
        ...first.messages,
        assistant,
        { role: 'tool', tool_call_id: 'toolu_01', content: 'a.txt\nb.txt' },
      ],
    };
    const next = await relayTranslated({
      inbound: 'openai-chat',
      endpoint: ANTHROPIC,
      body: second,
      stream: true,
      requestedModel: second.model,
      signal: new AbortController().signal,
      onDone: (outcome) => outcomes.push(outcome),
      fetcher,
    });
    expect(await next.text()).toContain('Two files.');

    // Claude gets its own thinking back, signed as it signed it, before the
    // call — what a thinking model needs on the next step of a tool loop.
    const messages = sent[1]?.messages as {
      role: string;
      content: unknown[];
    }[];
    expect(messages[1]).toEqual({
      role: 'assistant',
      content: [
        {
          type: 'thinking',
          thinking: 'I should list the files.',
          signature: 'EqQBsig-from-anthropic',
        },
        {
          type: 'tool_use',
          id: 'toolu_01',
          name: 'bash',
          input: { command: 'ls' },
        },
      ],
    });
    expect(messages[2]).toMatchObject({
      role: 'user',
      content: [{ type: 'tool_result', tool_use_id: 'toolu_01' }],
    });
  });
});
