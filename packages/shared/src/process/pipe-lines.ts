/**
 * Split a captured subprocess stream into lines, with a per-line length cap.
 *
 * Two source shapes: a web `ReadableStream<Uint8Array>` (Bun.spawn) and a Node
 * `Readable` (node `child_process`). Both strip a trailing `\r` (Windows CRLF)
 * and cap each line so a pathological 100KB stack-trace line can't bloat a ring
 * buffer.
 *
 * Two correctness details:
 *   - the cap counts CODE POINTS and slices on a code-point boundary, so a line
 *     truncated mid-emoji never emits a lone surrogate half;
 *   - EMPTY lines are passed through (not dropped). A blank line inside a stack
 *     trace is a continuation the stream classifier relies on to keep a
 *     multi-line error surfaced — dropping it silently broke the sticky-error
 *     chain. Classifiers treat a stray blank as noise, so passing it costs
 *     nothing.
 *
 * CLI/script-only (consumes runtime streams); never reached from the Convex V8
 * logger.
 */

const DEFAULT_MAX_LINE_CHARS = 8192;

/** Strip a trailing CR and cap to `maxChars` code points (never splitting one). */
function capLine(line: string, maxChars: number): string {
  const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line;
  // Fast path: UTF-16 length is an upper bound on code-point count, so a line
  // within the cap by `.length` is definitely within it by code points.
  if (trimmed.length <= maxChars) return trimmed;
  const codePoints = Array.from(trimmed);
  if (codePoints.length <= maxChars) return trimmed;
  return `${codePoints.slice(0, maxChars).join('')} …[truncated]`;
}

/** Share parsing between the two stream adapters. Only scan each incoming
 * chunk; a line with no newline must not grow or repeatedly scan its prefix.
 * Two UTF-16 units per code point plus one extra point guarantee truncation
 * even after stripping a final CR. Infinity explicitly keeps uncapped output. */
function lineSink(onLine: (line: string) => void, maxChars: number) {
  const maxUnits = 2 * (maxChars + 1);
  let buffer = '';
  let truncated = false;

  function append(chunk: string, start: number, end: number): void {
    if (truncated) return;
    const part = chunk.slice(
      start,
      Math.min(end, start + maxUnits - buffer.length),
    );
    // A short suffix can be a V8 SlicedString pointing at the ENTIRE chunk.
    // Copy fragments of oversized inputs before retaining/emitting them, not
    // only lines that truncate. The copied fragment itself is bounded, and
    // code-point splitting/joining preserves Unicode without re-encoding it.
    buffer += chunk.length > maxUnits ? Array.from(part).join('') : part;
    if (buffer.length >= maxUnits) {
      // capLine copies only this bounded prefix, so a slice cannot retain
      // the backing storage of an arbitrarily large incoming chunk.
      buffer = capLine(buffer, maxChars);
      truncated = true;
    }
  }

  function emit(): void {
    const line = truncated ? buffer : capLine(buffer, maxChars);
    buffer = '';
    truncated = false;
    onLine(line);
  }

  return {
    write(chunk: string): void {
      let start = 0;
      for (;;) {
        const end = chunk.indexOf('\n', start);
        if (end === -1) {
          append(chunk, start, chunk.length);
          return;
        }
        append(chunk, start, end);
        emit();
        start = end + 1;
      }
    },
    finish(): void {
      // The empty segment after a final newline is not another blank line.
      if (buffer) emit();
    },
  };
}

/** Pipe a web ReadableStream (Bun.spawn stdout/stderr) line-by-line. */
export async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
  maxLineChars: number = DEFAULT_MAX_LINE_CHARS,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  const sink = lineSink(onLine, maxLineChars);
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      sink.write(decoder.decode(value, { stream: true }));
    }
    sink.write(decoder.decode());
    sink.finish();
  } catch (error) {
    // Stop a still-producing source when its consumer throws; cancellation
    // failure must not replace the original read/consumer error.
    // Do not wait for a source that never acknowledges cancellation: the
    // consumer's error and reader unlock must still be delivered immediately.
    void reader.cancel().catch(() => {});
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Minimal Node-stream surface so we needn't value-import `node:stream`. */
interface NodeReadableLike {
  setEncoding(encoding: string): void;
  on(event: 'data', cb: (chunk: string) => void): void;
  on(event: 'end' | 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
  off(event: 'data', cb: (chunk: string) => void): void;
  off(event: 'end' | 'close', cb: () => void): void;
  off(event: 'error', cb: (err: Error) => void): void;
}

/** Pipe a Node Readable (child_process stdout/stderr) line-by-line. */
export function pipeNodeStream(
  stream: NodeReadableLike,
  onLine: (line: string) => void,
  maxLineChars: number = DEFAULT_MAX_LINE_CHARS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    const sink = lineSink(onLine, maxLineChars);
    let settled = false;
    stream.setEncoding('utf8');
    const cleanup = () => {
      stream.off('data', data);
      stream.off('end', finish);
      stream.off('close', finish);
      stream.off('error', fail);
    };
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };
    const data = (chunk: string) => {
      try {
        sink.write(chunk);
      } catch (error) {
        fail(error);
      }
    };
    // `end` and `close` can both fire — settle exactly once so the final line
    // isn't flushed twice.
    const finish = () => {
      if (settled) return;
      try {
        sink.finish();
      } catch (error) {
        fail(error);
        return;
      }
      settled = true;
      cleanup();
      resolve();
    };
    stream.on('data', data);
    stream.on('end', finish);
    stream.on('close', finish);
    // A stream error must reject (once) — otherwise the promise hangs forever,
    // stalling the spawn that awaits it.
    stream.on('error', fail);
  });
}
