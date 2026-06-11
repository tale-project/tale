// Chunk → line reassembler shared by both stream parsers. Both Claude Code
// (--output-format stream-json) and OpenCode (run --format json) emit
// newline-delimited JSON; chunks off the wire can split mid-line, so we buffer
// the trailing partial and only surface complete lines.

export class LineReassembler {
  private buf = '';

  /** Append a chunk; return the complete lines it completed (trimmed, empties
   * dropped). The trailing partial stays buffered. */
  push(chunk: string): string[] {
    this.buf += chunk;
    const lines: string[] = [];
    let nl = this.buf.indexOf('\n');
    while (nl !== -1) {
      const line = this.buf.slice(0, nl).trim();
      this.buf = this.buf.slice(nl + 1);
      if (line) lines.push(line);
      nl = this.buf.indexOf('\n');
    }
    return lines;
  }

  /** Flush any final unterminated line (some CLIs don't newline the last
   * record). Returns it as a single-element array, or empty. */
  flush(): string[] {
    const tail = this.buf.trim();
    this.buf = '';
    return tail ? [tail] : [];
  }
}

/** True for a plain JSON object (not null, not an array). Type-guard form so
 * callers narrow without an assertion. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/** Parse one NDJSON line to an object, or null on malformed JSON (logged by
 * the caller's parser as a `raw`/skip — never throws into the stream loop). */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return isRecord(v) ? v : null;
  } catch {
    return null;
  }
}
