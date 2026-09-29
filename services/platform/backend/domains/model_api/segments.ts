import { isRecord } from '../../../lib/utils/type-utils.ts';
import {
  MAX_TEXT_SEGMENTS,
  type SegmentPlace,
  type TextSegment,
} from './wire.ts';

/**
 * The caller text of one request, collected for the input guardrails as a
 * wire reader walks the body — with its size, and the media the reader
 * measured for the prompt estimate.
 *
 * On this surface the caller writes every role: the system prompt, the
 * person's turns, the assistant's (prefill included), the tool results and
 * the tool definitions. Text is text wherever it sits, so the readers hand
 * every stretch of it to the collector; skipping a role would be a way
 * around the organization's guardrails, not a narrower scan.
 *
 * Collection is bounded ({@link MAX_TEXT_SEGMENTS}): past the bound the
 * collector only notes the overflow, and the guardrails refuse the request.
 */
export class TextCollector {
  readonly segments: TextSegment[] = [];
  textBytes = 0;
  overflow = false;
  images = 0;
  documents = 0;
  mediaChars = 0;

  private push(segment: TextSegment, text: string): void {
    if (text.trim() === '') return;
    if (this.segments.length >= MAX_TEXT_SEGMENTS) {
      this.overflow = true;
      return;
    }
    this.segments.push(segment);
    this.textBytes += Buffer.byteLength(text);
  }

  /** A string field of an object, judged in place. */
  field(
    owner: Record<string, unknown>,
    key: string,
    where: SegmentPlace,
    maskable = true,
  ): void {
    const value = owner[key];
    if (typeof value !== 'string') return;
    this.push(
      {
        where,
        maskable,
        read: () => {
          const current = owner[key];
          return typeof current === 'string' ? current : '';
        },
        write: (text) => {
          owner[key] = text;
        },
      },
      value,
    );
  }

  /** A string entry of an array, judged in place. */
  entry(
    list: unknown[],
    index: number,
    where: SegmentPlace,
    maskable = true,
  ): void {
    const value = list[index];
    if (typeof value !== 'string') return;
    this.push(
      {
        where,
        maskable,
        read: () => {
          const current = list[index];
          return typeof current === 'string' ? current : '';
        },
        write: (text) => {
          list[index] = text;
        },
      },
      value,
    );
  }

  /** Every string in a JSON value — a tool call's input, its parsed
   * arguments — judged in place. Keys are structure, not text. */
  leaves(root: unknown, where: SegmentPlace, maskable = true): void {
    const stack: unknown[] = [root];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (let index = 0; index < node.length; index += 1) {
          const value: unknown = node[index];
          if (typeof value === 'string') {
            this.entry(node, index, where, maskable);
          } else if (typeof value === 'object' && value !== null) {
            stack.push(value);
          }
        }
      } else if (isRecord(node)) {
        for (const [key, value] of Object.entries(node)) {
          if (typeof value === 'string') {
            this.field(node, key, where, maskable);
          } else if (typeof value === 'object' && value !== null) {
            stack.push(value);
          }
        }
      }
    }
  }

  /** A JSON Schema's descriptions and titles, at any depth — what a tool's
   * parameters tell the model. Property names, enum values and defaults are
   * the schema's contract, left as they are. */
  schemaText(schema: unknown, where: SegmentPlace): void {
    const stack: unknown[] = [schema];
    while (stack.length > 0) {
      const node = stack.pop();
      if (Array.isArray(node)) {
        for (const value of node) {
          if (typeof value === 'object' && value !== null) stack.push(value);
        }
      } else if (isRecord(node)) {
        this.field(node, 'description', where);
        this.field(node, 'title', where);
        for (const value of Object.values(node)) {
          if (typeof value === 'object' && value !== null) stack.push(value);
        }
      }
    }
  }

  /** A string holding JSON — an OpenAI tool call's `arguments`: each string
   * in it judged, and the field rewritten from the judged value; a string
   * that is not JSON is judged whole. */
  jsonString(
    owner: Record<string, unknown>,
    key: string,
    where: SegmentPlace,
  ): void {
    const raw = owner[key];
    if (typeof raw !== 'string' || raw.trim() === '') return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (error) {
      console.warn(
        `[model-api] ${key} of a ${where} is not JSON; it is judged as one text:`,
        error instanceof Error ? error.message : error,
      );
      this.field(owner, key, where);
      return;
    }
    if (typeof parsed === 'string') {
      this.field(owner, key, where);
      return;
    }
    if (typeof parsed !== 'object' || parsed === null) return;
    const container: unknown = parsed;
    const inner = new TextCollector();
    inner.leaves(container, where);
    for (const segment of inner.segments) {
      this.push(
        {
          where,
          maskable: true,
          read: () => segment.read(),
          write: (text) => {
            segment.write(text);
            owner[key] = JSON.stringify(container);
          },
        },
        segment.read(),
      );
    }
    if (inner.overflow) this.overflow = true;
  }
}
