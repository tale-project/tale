// Chunk → line reassembler and untyped-wire helpers shared by every harness
// parser. All eight CLIs emit newline-delimited JSON (directly or through a
// tale-*-run wrapper); chunks off the wire can split mid-line, so the
// reassembler buffers the trailing partial and only surfaces complete lines.

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

export const HARNESS_ID_LEDGER_MAX_ENTRIES = 16_384;
const HARNESS_ID_LEDGER_MAX_CHARS = 1024 * 1024;
const HARNESS_ID_MAX_CHARS = 4096;

/** Usage/tool deduplication facts cannot be evicted without changing the
 * result. Refuse excess explicitly; bookkeeping is constant time per ID. A
 * fresh parser/window owns a fresh ledger and rebuilds it from full replay. */
export class BoundedIdLedger {
  private readonly ids = new Set<string>();
  private chars = 0;

  has(id: string): boolean {
    return this.ids.has(id);
  }

  add(id: string): void {
    if (this.ids.has(id)) return;
    if (id.length > HARNESS_ID_MAX_CHARS)
      throw new Error(
        `Harness deduplication identifier exceeds ${HARNESS_ID_MAX_CHARS} characters.`,
      );
    if (
      this.ids.size >= HARNESS_ID_LEDGER_MAX_ENTRIES ||
      this.chars + id.length > HARNESS_ID_LEDGER_MAX_CHARS
    )
      throw new Error(
        'Harness deduplication ledger exceeds its memory budget.',
      );
    this.ids.add(id);
    this.chars += id.length;
  }
}

export class LineReassembler {
  private buf = '';

  /** A malformed/no-newline harness cannot retain an unbounded protocol
   * record. Refuse explicitly instead of truncating JSON or losing a result. */
  constructor(private readonly maxChars = HARNESS_RECORD_MAX_CHARS) {}

  /** Append a chunk; return the complete lines it completed (trimmed, empties
   * dropped). The trailing partial stays buffered. */
  push(chunk: string): string[] {
    const lines: string[] = [];
    let offset = 0;
    let nl = chunk.indexOf('\n');
    while (nl !== -1) {
      this.append(chunk.slice(offset, nl));
      const line = this.buf.trim();
      this.buf = '';
      if (line) lines.push(line);
      offset = nl + 1;
      nl = chunk.indexOf('\n', offset);
    }
    this.append(chunk.slice(offset));
    return lines;
  }

  private append(part: string): void {
    if (this.buf.length + part.length > this.maxChars) {
      this.buf = '';
      throw new Error(
        `Harness protocol record exceeds ${this.maxChars} characters`,
      );
    }
    this.buf += part;
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
