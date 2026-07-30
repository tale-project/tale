import { describe, expect, it } from 'vitest';

import {
  readEvent,
  settleToolCalls,
  type StreamDecodeState,
} from './turn_action';

/**
 * The stream decoder's tool seam: both dialects announce a call once and
 * then drip its arguments as JSON fragments across events. What matters is
 * the ACCUMULATION — a fragment boundary can fall inside a JSON string — so
 * these tests drive the decoder event by event, exactly as the SSE reader
 * does, and assert on the settled calls.
 */

function state(): StreamDecodeState {
  return { running: { input: 0, output: 0 }, drafts: new Map() };
}

describe('readEvent — anthropic tool decode', () => {
  it('accumulates input_json_delta fragments into one parsed call', () => {
    const s = state();
    readEvent(
      'anthropic',
      {
        type: 'content_block_start',
        index: 1,
        content_block: { type: 'tool_use', id: 'toolu_1', name: 'rag_search' },
      },
      s,
    );
    readEvent(
      'anthropic',
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: '{"query": "ret' },
      },
      s,
    );
    readEvent(
      'anthropic',
      {
        type: 'content_block_delta',
        index: 1,
        delta: { type: 'input_json_delta', partial_json: 'urns"}' },
      },
      s,
    );
    expect(settleToolCalls(s.drafts)).toEqual([
      { id: 'toolu_1', name: 'rag_search', input: { query: 'returns' } },
    ]);
  });

  it('keeps text and thinking deltas flowing while a call accumulates', () => {
    const s = state();
    readEvent(
      'anthropic',
      {
        type: 'content_block_start',
        index: 0,
        content_block: { type: 'tool_use', id: 't', name: 'web_fetch' },
      },
      s,
    );
    const text = readEvent(
      'anthropic',
      {
        type: 'content_block_delta',
        index: 2,
        delta: { type: 'text_delta', text: 'hi' },
      },
      s,
    );
    expect(text.text).toBe('hi');
  });
});

describe('readEvent — openai tool decode', () => {
  it('accumulates fragments by index, id and name arriving once', () => {
    const s = state();
    readEvent(
      'openai',
      {
        choices: [
          {
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: 'call_a',
                  function: { name: 'rag_fetch', arguments: '' },
                },
              ],
            },
          },
        ],
      },
      s,
    );
    readEvent(
      'openai',
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"ref":"fi' } }],
            },
          },
        ],
      },
      s,
    );
    readEvent(
      'openai',
      {
        choices: [
          {
            delta: {
              tool_calls: [{ index: 0, function: { arguments: 'le_1"}' } }],
            },
          },
        ],
      },
      s,
    );
    expect(settleToolCalls(s.drafts)).toEqual([
      { id: 'call_a', name: 'rag_fetch', input: { ref: 'file_1' } },
    ]);
  });

  it('orders parallel calls by index and synthesizes missing ids', () => {
    const s = state();
    readEvent(
      'openai',
      {
        choices: [
          {
            delta: {
              tool_calls: [
                { index: 1, function: { name: 'web_fetch', arguments: '{}' } },
                {
                  index: 0,
                  id: 'call_z',
                  function: { name: 'rag_search', arguments: '{}' },
                },
              ],
            },
          },
        ],
      },
      s,
    );
    const calls = settleToolCalls(s.drafts);
    expect(calls.map((call) => call.name)).toEqual(['rag_search', 'web_fetch']);
    expect(calls[1]?.id).toBe('call_1');
  });
});

describe('settleToolCalls — argument parsing', () => {
  it('keeps the raw string when the arguments do not parse', () => {
    const drafts = new Map([
      [0, { id: 'c', name: 'rag_search', argumentsJson: '{"query": ' }],
    ]);
    expect(settleToolCalls(drafts)).toEqual([
      { id: 'c', name: 'rag_search', input: {}, rawInput: '{"query": ' },
    ]);
  });

  it('reads empty arguments as an empty object and drops nameless drafts', () => {
    const drafts = new Map([
      [0, { id: 'c1', name: 'rag_search', argumentsJson: '' }],
      [1, { id: 'c2', name: '', argumentsJson: '{"x":1}' }],
    ]);
    expect(settleToolCalls(drafts)).toEqual([
      { id: 'c1', name: 'rag_search', input: {} },
    ]);
  });
});
