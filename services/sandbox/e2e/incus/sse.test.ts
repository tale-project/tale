import { describe, expect, test } from 'bun:test';

import { readSse, type SseEvent } from './sse.ts';

function stream(...chunks: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
}

async function collect(body: ReadableStream<Uint8Array>): Promise<SseEvent[]> {
  const events: SseEvent[] = [];
  for await (const event of readSse(body)) events.push(event);
  return events;
}

describe('readSse', () => {
  test('reads named events with JSON data', async () => {
    const events = await collect(
      stream(
        'event: phase\ndata: {"phase":"running"}\n\n',
        'event: stdout\ndata: {"text":"hi\\n","seq":1}\n\n',
      ),
    );
    expect(events.map((event) => [event.event, event.data])).toEqual([
      ['phase', { phase: 'running' }],
      ['stdout', { text: 'hi\n', seq: 1 }],
    ]);
  });

  test('joins a frame that arrives in pieces and skips keepalive comments', async () => {
    const events = await collect(
      stream(
        ': keepalive\n\nevent: res',
        'ult\ndata: {"status":"comp',
        'leted"}\n\n: keepalive\n\n',
      ),
    );
    expect(events).toHaveLength(1);
    expect(events[0]?.event).toBe('result');
    expect(events[0]?.data).toEqual({ status: 'completed' });
  });

  test('keeps data that is not JSON as text, and reads a last frame without its blank line', async () => {
    const events = await collect(
      stream('event: error\ndata: boom\n\n', 'event: result\ndata: {"a":1}'),
    );
    expect(events.map((event) => [event.event, event.data])).toEqual([
      ['error', 'boom'],
      ['result', { a: 1 }],
    ]);
  });

  test('handles CRLF framing and stamps each event with a rising time', async () => {
    const events = await collect(
      stream('event: a\r\ndata: 1\r\n\r\nevent: b\r\ndata: 2\r\n\r\n'),
    );
    expect(events.map((event) => event.event)).toEqual(['a', 'b']);
    expect(events[1]?.atMs ?? 0).toBeGreaterThanOrEqual(events[0]?.atMs ?? 0);
  });
});
