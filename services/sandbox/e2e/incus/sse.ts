// A reader for the spawner's server-sent events (src/sse.ts):
// `event: <name>\ndata: <json>\n\n`, with `: keepalive` comment frames between.

export interface SseEvent {
  event: string;
  /** The parsed `data`, or its text when it is not JSON. */
  data: unknown;
  /** When the frame was complete, in ms since the stream was opened. */
  atMs: number;
}

function parseFrame(frame: string, atMs: number): SseEvent | undefined {
  let event = 'message';
  const data: string[] = [];
  for (const line of frame.split('\n')) {
    if (line === '' || line.startsWith(':')) continue;
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '');
    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
  }
  if (data.length === 0) return undefined;
  const text = data.join('\n');
  try {
    return { event, data: JSON.parse(text), atMs };
  } catch {
    return { event, data: text, atMs };
  }
}

/** Every event of a stream, as it completes. */
export async function* readSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<SseEvent> {
  const started = performance.now();
  const decoder = new TextDecoder();
  const reader = body.getReader();
  let pending = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder
        .decode(value, { stream: true })
        .replaceAll('\r\n', '\n');
      for (;;) {
        const end = pending.indexOf('\n\n');
        if (end === -1) break;
        const frame = pending.slice(0, end);
        pending = pending.slice(end + 2);
        const parsed = parseFrame(frame, performance.now() - started);
        if (parsed !== undefined) yield parsed;
      }
    }
    pending += decoder.decode();
    const last = parseFrame(pending, performance.now() - started);
    if (last !== undefined) yield last;
  } finally {
    reader.releaseLock();
  }
}
