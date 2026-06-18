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

/** Pipe a web ReadableStream (Bun.spawn stdout/stderr) line-by-line. */
export async function pipeLines(
  stream: ReadableStream<Uint8Array>,
  onLine: (line: string) => void,
  maxLineChars: number = DEFAULT_MAX_LINE_CHARS,
): Promise<void> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) onLine(capLine(line, maxLineChars));
  }
  // Flush a final unterminated line (skip an empty tail — that's just the
  // segment after the last newline, not a real blank line).
  if (buffer) onLine(capLine(buffer, maxLineChars));
}

/** Minimal Node-stream surface so we needn't value-import `node:stream`. */
interface NodeReadableLike {
  setEncoding(encoding: string): void;
  on(event: 'data', cb: (chunk: string) => void): void;
  on(event: 'end' | 'close', cb: () => void): void;
  on(event: 'error', cb: (err: Error) => void): void;
}

/** Pipe a Node Readable (child_process stdout/stderr) line-by-line. */
export function pipeNodeStream(
  stream: NodeReadableLike,
  onLine: (line: string) => void,
  maxLineChars: number = DEFAULT_MAX_LINE_CHARS,
): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    let buffer = '';
    let settled = false;
    stream.setEncoding('utf8');
    stream.on('data', (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) onLine(capLine(line, maxLineChars));
    });
    // `end` and `close` can both fire — settle exactly once so the final line
    // isn't flushed twice.
    const finish = () => {
      if (settled) return;
      settled = true;
      if (buffer) {
        onLine(capLine(buffer, maxLineChars));
        buffer = '';
      }
      resolve();
    };
    stream.on('end', finish);
    stream.on('close', finish);
    // A stream error must reject (once) — otherwise the promise hangs forever,
    // stalling the spawn that awaits it.
    stream.on('error', (err) => {
      if (settled) return;
      settled = true;
      reject(err);
    });
  });
}
