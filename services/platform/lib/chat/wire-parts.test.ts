import { describe, expect, it } from 'vitest';

import type { ChatMessage } from './types';
import { explodeMessagesForWire, toolResultContent } from './wire-parts';

/**
 * One persistence shape — ordered parts on one assistant message — must
 * explode into the dialect alternation deterministically: assistant turns
 * carry text + calls, tool turns carry results, and the sequence a model
 * needs (call, then result, then continuation) falls out of part order.
 */

describe('explodeMessagesForWire', () => {
  it('prepends the system prompt and flattens plain turns', () => {
    const wire = explodeMessagesForWire('Be helpful.', [
      { role: 'user', parts: [{ type: 'text', text: 'hi' }] },
      { role: 'assistant', parts: [{ type: 'text', text: 'hello' }] },
    ]);
    expect(wire).toEqual([
      { role: 'system', content: 'Be helpful.' },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('explodes an interleaved tool turn into the wire alternation', () => {
    const stored: ChatMessage = {
      role: 'assistant',
      parts: [
        { type: 'reasoning', text: 'thinking…' },
        { type: 'text', text: 'Let me check.' },
        {
          type: 'tool-call',
          callId: 'c1',
          capabilityId: 'rag_search',
          input: { query: 'returns' },
        },
        {
          type: 'tool-result',
          callId: 'c1',
          capabilityId: 'rag_search',
          output: { hits: 2 },
          structured: true,
        },
        { type: 'text', text: 'Found it: 30 days.' },
      ],
    };
    const wire = explodeMessagesForWire('', [stored]);
    expect(wire).toEqual([
      {
        role: 'assistant',
        content: 'Let me check.',
        toolCalls: [
          { id: 'c1', name: 'rag_search', input: { query: 'returns' } },
        ],
      },
      {
        role: 'tool',
        content: '',
        toolResults: [{ callId: 'c1', content: '{"hits":2}' }],
      },
      { role: 'assistant', content: 'Found it: 30 days.' },
    ]);
  });

  it('never replays reasoning and keeps an empty assistant turn occupied', () => {
    const wire = explodeMessagesForWire('', [
      { role: 'assistant', parts: [{ type: 'reasoning', text: 'secret' }] },
    ]);
    expect(wire).toEqual([{ role: 'assistant', content: '' }]);
  });

  it('groups consecutive calls into one assistant turn and their results into one tool turn', () => {
    const wire = explodeMessagesForWire('', [
      {
        role: 'assistant',
        parts: [
          {
            type: 'tool-call',
            callId: 'c1',
            capabilityId: 'rag_search',
            input: { query: 'a' },
          },
          {
            type: 'tool-call',
            callId: 'c2',
            capabilityId: 'web_fetch',
            input: { url: 'https://example.com' },
          },
          {
            type: 'tool-result',
            callId: 'c1',
            capabilityId: 'rag_search',
            output: 'one',
            structured: true,
          },
          {
            type: 'tool-result',
            callId: 'c2',
            capabilityId: 'web_fetch',
            output: 'two',
            structured: true,
          },
        ],
      },
    ]);
    expect(wire).toHaveLength(2);
    expect(wire[0]?.toolCalls?.map((call) => call.id)).toEqual(['c1', 'c2']);
    expect(wire[1]?.toolResults?.map((result) => result.callId)).toEqual([
      'c1',
      'c2',
    ]);
  });

  it('reads a stored tool-role message as a results turn', () => {
    const wire = explodeMessagesForWire('', [
      {
        role: 'tool',
        parts: [
          {
            type: 'tool-result',
            callId: 'c9',
            capabilityId: 'rag_fetch',
            output: 'body',
            structured: true,
          },
        ],
      },
    ]);
    expect(wire).toEqual([
      {
        role: 'tool',
        content: '',
        toolResults: [{ callId: 'c9', content: 'body' }],
      },
    ]);
  });
});

describe('toolResultContent', () => {
  it('passes strings through and serializes everything else', () => {
    expect(toolResultContent('plain')).toBe('plain');
    expect(toolResultContent({ a: 1 })).toBe('{"a":1}');
    expect(toolResultContent(undefined)).toBe('');
  });
});

describe('attachment refs on the wire', () => {
  it('lifts image attachments with a blob ref off the user text surface', () => {
    const wire = explodeMessagesForWire('SYS', [
      {
        role: 'user',
        parts: [
          { type: 'text', text: 'look at this' },
          {
            type: 'attachment',
            name: 'shot.png',
            mediaType: 'image/png',
            fileId: 'blob1',
          },
          {
            type: 'attachment',
            name: 'report.pdf',
            mediaType: 'application/pdf',
            fileId: 'blob2',
          },
          { type: 'attachment', name: 'legacy.png', mediaType: 'image/png' },
        ],
      },
    ]);
    // The image WITH a ref is lifted; the non-image and the ref-less image
    // keep reading as their text surfaces, exactly as before.
    expect(wire[1]).toEqual({
      role: 'user',
      content:
        'look at this\n[attachment: report.pdf]\n[attachment: legacy.png]',
      attachmentRefs: [
        { fileId: 'blob1', name: 'shot.png', mediaType: 'image/png' },
      ],
    });
  });

  it('leaves a ref-free user turn byte-identical to the old shape', () => {
    const wire = explodeMessagesForWire('SYS', [
      { role: 'user', parts: [{ type: 'text', text: 'plain' }] },
    ]);
    expect(wire[1]).toEqual({ role: 'user', content: 'plain' });
  });
});
