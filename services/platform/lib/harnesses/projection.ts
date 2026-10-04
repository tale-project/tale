/** Bounded incremental display state. Protocol lifecycle/accounting remains
 * independent of this tail: evicting a display entry never forgets a task or
 * usage event. A disk replay can be arbitrarily longer than the displayed log. */
import { appendHarnessAnswer } from './jsonl';
import {
  TIMELINE_MAX_ENTRIES,
  TIMELINE_MAX_JSON_BYTES,
  type TimelinePart,
} from './timeline';
import type { HarnessEvent } from './types';

export const HARNESS_TEXT_MAX_CHARS = 64 * 1024;
const VALUE_CHARS = 2000;
const BLOCK_CHARS = 4000;

/** A visible tail, including its truncation marker within the budget. */
export function textTail(
  value: string,
  maxChars = HARNESS_TEXT_MAX_CHARS,
): string {
  return value.length <= maxChars ? value : `…${value.slice(-(maxChars - 1))}`;
}

function clampValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  if (json === undefined) return undefined;
  return json.length <= VALUE_CHARS ? value : `${json.slice(0, VALUE_CHARS)}…`;
}

interface Entry {
  part: TimelinePart;
  bytes: number;
}

const encoder = new TextEncoder();
const sizeOf = (part: TimelinePart) =>
  encoder.encode(JSON.stringify(part)).length;

class TimelineTail {
  private entries: Entry[] = [];
  private tools = new Map<string, Entry>();
  private textBlock: Entry | undefined;
  private bytes = 0;

  private bound(): void {
    while (
      this.entries.length > 1 &&
      (this.entries.length > TIMELINE_MAX_ENTRIES ||
        this.bytes > TIMELINE_MAX_JSON_BYTES)
    ) {
      const dropped = this.entries.shift();
      if (dropped === undefined) break;
      this.bytes -= dropped.bytes;
      const id = dropped.part.toolCallId;
      if (id !== undefined && this.tools.get(id) === dropped)
        this.tools.delete(id);
      if (this.textBlock === dropped) this.textBlock = undefined;
    }
  }

  private append(part: TimelinePart): Entry {
    const entry = { part, bytes: sizeOf(part) };
    this.entries.push(entry);
    this.bytes += entry.bytes;
    this.bound();
    return entry;
  }

  private update(entry: Entry, part: TimelinePart): void {
    this.bytes -= entry.bytes;
    // A previously emitted snapshot may still be queued for storage. Never
    // mutate the objects it holds when the next tool result/delta arrives.
    entry.part = part;
    entry.bytes = sizeOf(part);
    this.bytes += entry.bytes;
    this.bound();
  }

  text(value: string, separator: string): void {
    if (value === '') return;
    const previous = this.textBlock?.part.text ?? '';
    const text = textTail(
      `${previous}${previous === '' ? '' : separator}${value}`,
      BLOCK_CHARS,
    );
    if (this.textBlock === undefined)
      this.textBlock = this.append({ type: 'text', text });
    else this.update(this.textBlock, { type: 'text', text });
  }

  tool(
    event: Extract<HarnessEvent, { type: 'tool-use' }>,
    input: unknown,
  ): void {
    this.textBlock = undefined;
    const entry = this.append({
      type: `tool-${event.toolName}`,
      toolCallId: event.toolUseId,
      state: 'input-available',
      ...(input !== undefined ? { input } : {}),
    });
    this.tools.set(event.toolUseId, entry);
  }

  result(
    event: Extract<HarnessEvent, { type: 'tool-result' }>,
    output: unknown,
  ): void {
    const entry = this.tools.get(event.toolUseId);
    if (entry === undefined) return;
    this.update(entry, {
      ...entry.part,
      state: event.isError === true ? 'output-error' : 'output-available',
      ...(event.isError === true
        ? {
            errorText:
              typeof output === 'string' ? output : JSON.stringify(output),
          }
        : output !== undefined
          ? { output }
          : {}),
    });
  }

  snapshot(): TimelinePart[] {
    return this.entries.map((entry) => entry.part);
  }
}

export class HarnessProjection {
  // Some CLIs report both deltas and the completed text. Keep independently
  // bounded projections until the first delta establishes the display lane.
  private full = new TimelineTail();
  private deltas = new TimelineTail();
  private fullText = '';
  private deltaText = '';
  private answerText = '';
  private streamsDeltas = false;
  revision = 0;

  accept(event: HarnessEvent): void {
    if (event.type === 'text') {
      if (this.streamsDeltas) return;
      this.answerText = appendHarnessAnswer(
        this.answerText,
        `${this.answerText === '' ? '' : '\n\n'}${event.text}`,
      );
      this.fullText = textTail(
        `${this.fullText}${this.fullText === '' ? '' : '\n\n'}${event.text}`,
      );
      this.full.text(event.text, '\n\n');
    } else if (event.type === 'text-delta') {
      if (!this.streamsDeltas) {
        this.streamsDeltas = true;
        this.full = new TimelineTail();
        this.fullText = '';
        this.answerText = '';
      }
      this.answerText = appendHarnessAnswer(this.answerText, event.text);
      this.deltaText = textTail(this.deltaText + event.text);
      this.deltas.text(event.text, '');
    } else if (event.type === 'tool-use') {
      if (event.toolUseId.length > 1024 || event.toolName.length > 256) {
        throw new Error('Harness tool identifier exceeds its safety budget');
      }
      const input = clampValue(event.input);
      if (!this.streamsDeltas) this.full.tool(event, input);
      this.deltas.tool(event, input);
    } else if (event.type === 'tool-result') {
      const output = clampValue(event.output);
      if (!this.streamsDeltas) this.full.result(event, output);
      this.deltas.result(event, output);
    } else return;
    this.revision += 1;
  }

  /** Exact fallback for a terminal record without its own finalText. Kept
   * separate from the visible tail, under the shared explicit answer cap. */
  get answer(): string {
    return this.answerText;
  }

  get text(): string {
    return this.streamsDeltas ? this.deltaText : this.fullText;
  }

  timeline(): TimelinePart[] {
    return (this.streamsDeltas ? this.deltas : this.full).snapshot();
  }
}
