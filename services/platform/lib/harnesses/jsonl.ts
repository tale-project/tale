// Chunk → line reassembler and untyped-wire helpers shared by every harness
// parser. All eight CLIs emit newline-delimited JSON (directly or through a
// tale-*-run wrapper); chunks off the wire can split mid-line, so the
// reassembler buffers the trailing partial and only surfaces complete lines.

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

/** Parse one NDJSON line to an object, or null on malformed JSON. Never
 * throws into the stream loop; the caller's parser drops the line (and logs
 * it) on null. */
export function parseJsonLine(line: string): Record<string, unknown> | null {
  try {
    const v: unknown = JSON.parse(line);
    return isRecord(v) ? v : null;
  } catch {
    // Malformed JSON is an expected wire condition (e.g. a process dying
    // mid-record); the caller logs the dropped line.
    return null;
  }
}

/** The string, or undefined for any other type (coalesces JSON null too). */
export function asString(v: unknown): string | undefined {
  return typeof v === 'string' ? v : undefined;
}

/** The finite number, or undefined for any other value (NaN/Infinity too). */
export function asNumber(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

export function asRecord(v: unknown): Record<string, unknown> | undefined {
  return isRecord(v) ? v : undefined;
}

export function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : [];
}
