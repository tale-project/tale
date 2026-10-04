// Chunk → line reassembler and untyped-wire helpers shared by every harness
// parser. All eight CLIs emit newline-delimited JSON (directly or through a
// tale-*-run wrapper); chunks off the wire can split mid-line, so the
// reassembler buffers the trailing partial and only surfaces complete lines.

/** A protocol record can contain large tool output, but an absent newline
 * must not grow a worker forever. This is independent of the display cap. */
export const MAX_HARNESS_JSONL_RECORD_BYTES = 8 * 1024 * 1024;
const encoder = new TextEncoder();

export class HarnessJsonlRecordTooLargeError extends Error {
  constructor() {
    super(
      'Harness JSONL record exceeded 8 MiB; refusing incomplete agent output.',
    );
    this.name = 'HarnessJsonlRecordTooLargeError';
  }
}

export const HARNESS_RECORD_MAX_CHARS = 8 * 1024 * 1024;

/** Authoritative answers are never truncated to the display budget. A CLI
 * that builds its final answer from many records gets the same explicit
 * safety refusal as one reporting it in a single oversized record. */
export function appendHarnessAnswer(current: string, next: string): string {
  if (current.length + next.length > HARNESS_RECORD_MAX_CHARS) {
    throw new Error(
      `Harness final answer exceeds ${HARNESS_RECORD_MAX_CHARS} characters`,
    );
  }
  return current + next;
}

export class LineReassembler {
  constructor(private readonly maxBytes = MAX_HARNESS_JSONL_RECORD_BYTES) {}
  private buf = '';
  private bytes = 0;
  private lastCodeUnit = 0;
  private failure: HarnessJsonlRecordTooLargeError | undefined;

  private checkSize(bytes: number): void {
    if (this.failure !== undefined) throw this.failure;
    if (bytes <= this.maxBytes) return;
    this.buf = '';
    this.bytes = 0;
    this.failure = new HarnessJsonlRecordTooLargeError();
    throw this.failure;
  }

  snapshot(): string {
    if (this.failure !== undefined) throw this.failure;
    return this.buf;
  }

  restore(buffer: string): void {
    const bytes = encoder.encode(buffer).byteLength;
    this.checkSize(bytes);
    this.buf = buffer;
    this.bytes = bytes;
    this.lastCodeUnit = buffer.charCodeAt(buffer.length - 1);
  }

  /** Append a chunk; return complete lines (trimmed, empties dropped). Check
   * every record before retaining it, including complete oversized records.
   * Count each new fragment once so a long partial is not rescanned per chunk. */
  push(chunk: string): string[] {
    if (this.failure !== undefined) throw this.failure;
    const lines: string[] = [];
    let start = 0;
    while (start < chunk.length) {
      const nl = chunk.indexOf('\n', start);
      const fragment = chunk.slice(start, nl === -1 ? undefined : nl);
      let bytes = this.bytes + encoder.encode(fragment).byteLength;
      // A UTF-16 surrogate pair can straddle callbacks. Separately encoded
      // halves cost 3 + 3 bytes; together they represent 4 UTF-8 bytes.
      const first = fragment.charCodeAt(0);
      if (
        this.lastCodeUnit >= 0xd800 &&
        this.lastCodeUnit <= 0xdbff &&
        first >= 0xdc00 &&
        first <= 0xdfff
      )
        bytes -= 2;
      this.checkSize(bytes);
      this.buf += fragment;
      this.bytes = bytes;
      if (fragment !== '')
        this.lastCodeUnit = fragment.charCodeAt(fragment.length - 1);
      if (nl === -1) break;
      const line = this.buf.trim();
      if (line) lines.push(line);
      this.buf = '';
      this.bytes = 0;
      this.lastCodeUnit = 0;
      start = nl + 1;
    }
    return lines;
  }

  /** Flush a final unterminated record; an overflow never exposes a suffix. */
  flush(): string[] {
    if (this.failure !== undefined) throw this.failure;
    const tail = this.buf.trim();
    this.buf = '';
    this.bytes = 0;
    this.lastCodeUnit = 0;
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
