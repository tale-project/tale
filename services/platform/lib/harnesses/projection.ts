import { z } from 'zod';

import { boundTimelineParts, type TimelinePart } from './timeline';
import type { HarnessEvent } from './types';

export const HARNESS_TEXT_MAX_CHARS = 64 * 1024;
const TEXT_CHARS = HARNESS_TEXT_MAX_CHARS;
const encoder = new TextEncoder();
const BLOCK_CHARS = 4_000;
const VALUE_CHARS = 2_000;
// Leave space in the 1 MiB checkpoint for parser state and partial JSONL.
const TIMELINE_BYTES = 240_000;
const partSchema = z.object({
  type: z.string(),
  text: z.string().optional(),
  state: z.string().optional(),
  toolCallId: z.string().optional(),
  input: z.unknown().optional(),
  output: z.unknown().optional(),
  errorText: z.string().optional(),
});
const projectionSchema = z.object({
  text: z.string(),
  streamsDeltas: z.boolean(),
  textTruncated: z.boolean().optional(),
  parts: z.array(partSchema),
});

export function textTail(text: string, limit = HARNESS_TEXT_MAX_CHARS): string {
  return text.length <= limit ? text : `…${text.slice(-(limit - 1))}`;
}

function boundedValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  return json === undefined || json.length <= VALUE_CHARS
    ? value
    : `${json.slice(0, VALUE_CHARS)}…`;
}

/** A bounded incremental display projection. Raw events and large tool
 * payloads never accumulate for the duration of a drain window. */
export class HarnessProjection {
  text = '';
  textTruncated = false;
  revision = 0;
  private streamsDeltas = false;
  private parts: TimelinePart[] = [];
  private sizes: number[] = [];
  private bytes = 0;
  private offset = 0;
  private tools = new Map<string, number>();

  private indexSizes(): void {
    this.offset = 0;
    this.tools.clear();
    this.parts.forEach((part, index) => {
      if (part.toolCallId !== undefined) this.tools.set(part.toolCallId, index);
    });
    this.sizes = this.parts.map(
      (part) => encoder.encode(JSON.stringify(part)).byteLength,
    );
    this.bytes = this.sizes.reduce((sum, size) => sum + size, 0);
  }

  private writePart(index: number, part: TimelinePart): void {
    const size = encoder.encode(JSON.stringify(part)).byteLength;
    this.bytes += size - (this.sizes[index] ?? 0);
    this.sizes[index] = size;
    this.parts[index] = part;
    if (part.toolCallId !== undefined)
      this.tools.set(part.toolCallId, index + this.offset);
    while (
      this.parts.length > 1 &&
      (this.parts.length > 400 || this.bytes > TIMELINE_BYTES)
    ) {
      this.bytes -= this.sizes.shift() ?? 0;
      const dropped = this.parts.shift();
      if (
        dropped?.toolCallId !== undefined &&
        this.tools.get(dropped.toolCallId) === this.offset
      )
        this.tools.delete(dropped.toolCallId);
      this.offset++;
    }
  }

  restore(value: unknown): void {
    const state = projectionSchema.parse(value);
    this.text = textTail(state.text, TEXT_CHARS);
    this.textTruncated =
      state.textTruncated === true || state.text.length > TEXT_CHARS;
    this.streamsDeltas = state.streamsDeltas;
    this.parts = boundTimelineParts(state.parts, {
      maxEntries: 400,
      maxJsonBytes: TIMELINE_BYTES,
    });
    this.indexSizes();
  }

  snapshot(): Record<string, unknown> {
    return {
      text: this.text,
      textTruncated: this.textTruncated,
      streamsDeltas: this.streamsDeltas,
      parts: this.timeline(),
    };
  }

  timeline(): TimelinePart[] {
    // Every entry is replaced rather than mutated when its state advances.
    return [...this.parts];
  }

  accept(event: HarnessEvent): void {
    if (event.type === 'text' || event.type === 'text-delta') {
      if (event.type === 'text-delta' && !this.streamsDeltas) {
        this.streamsDeltas = true;
        this.text = '';
        this.textTruncated = false;
        this.parts = this.parts.filter((part) => part.type !== 'text');
        this.indexSizes();
      }
      if (event.type === 'text' && this.streamsDeltas) return;
      const separator = event.type === 'text' && this.text !== '' ? '\n\n' : '';
      const fullText = this.text + separator + event.text;
      this.textTruncated ||= fullText.length > TEXT_CHARS;
      this.text = textTail(fullText, TEXT_CHARS);
      const previous = this.parts.at(-1);
      const words = previous?.type === 'text' ? (previous.text ?? '') : '';
      const text = textTail(
        words +
          (words !== '' && event.type === 'text' ? '\n\n' : '') +
          event.text,
        BLOCK_CHARS,
      );
      const part = { type: 'text', text };
      this.writePart(
        previous?.type === 'text' ? this.parts.length - 1 : this.parts.length,
        part,
      );
      this.revision++;
    } else if (event.type === 'tool-use') {
      if (event.toolUseId.length > 1024 || event.toolName.length > 256)
        throw new Error('Harness tool identifier exceeds its safety budget');
      const input = boundedValue(event.input);
      this.writePart(this.parts.length, {
        type: `tool-${event.toolName}`,
        state: 'input-available',
        toolCallId: event.toolUseId,
        ...(input !== undefined ? { input } : {}),
      });
      this.revision++;
    } else if (event.type === 'tool-result') {
      const position = this.tools.get(event.toolUseId);
      if (position === undefined) return;
      const at = position - this.offset;
      const previous = this.parts[at];
      if (previous === undefined) return;
      const output = boundedValue(event.output);
      this.writePart(at, {
        ...previous,
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
      this.revision++;
    } else return;
  }
}
