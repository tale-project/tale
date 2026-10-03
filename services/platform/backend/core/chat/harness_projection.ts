import {
  boundTimelineParts,
  TIMELINE_MAX_ENTRIES,
  type TimelinePart,
} from '../../../lib/harnesses/timeline';
import type { HarnessEvent } from '../../../lib/harnesses/types';

/** The live status text is a tail, not the harness journal or final report. */
export const HARNESS_PROGRESS_TEXT_CHARS = 128 * 1024;
const TIMELINE_VALUE_CHARS = 2000;
const TIMELINE_TEXT_CHARS = 4000;

function tail(text: string, size: number): string {
  return text.length <= size ? text : `…${text.slice(-size)}`;
}

function clampValue(value: unknown): unknown {
  if (value === undefined) return undefined;
  const json = JSON.stringify(value);
  return json === undefined
    ? undefined
    : json.length <= TIMELINE_VALUE_CHARS
      ? value
      : `${json.slice(0, TIMELINE_VALUE_CHARS)}…`;
}

/** A bounded projection for one text dialect. Keep both until a streaming
 * delta chooses that dialect: complete text blocks must never duplicate it. */
class Transcript {
  private parts: TimelinePart[] = [];
  private byTool = new Map<string, TimelinePart>();
  private block = '';
  text = '';

  append(text: string, separator: string): void {
    this.text = tail(
      this.text + (this.text === '' ? '' : separator) + text,
      HARNESS_PROGRESS_TEXT_CHARS,
    );
    this.block = tail(
      this.block + (this.block === '' ? '' : separator) + text,
      TIMELINE_TEXT_CHARS,
    );
  }

  tool(part: TimelinePart): void {
    if (this.block !== '') {
      this.parts.push({ type: 'text', text: this.block });
      this.block = '';
    }
    const copy = { ...part };
    this.parts.push(copy);
    if (copy.toolCallId !== undefined) this.byTool.set(copy.toolCallId, copy);
    while (this.parts.length > TIMELINE_MAX_ENTRIES) {
      const removed = this.parts.shift();
      if (
        removed?.toolCallId !== undefined &&
        this.byTool.get(removed.toolCallId) === removed
      ) {
        this.byTool.delete(removed.toolCallId);
      }
    }
  }

  result(id: string, patch: Partial<TimelinePart>): void {
    const part = this.byTool.get(id);
    if (part !== undefined) Object.assign(part, patch);
  }

  snapshot(): TimelinePart[] {
    const parts =
      this.block === ''
        ? this.parts
        : [...this.parts, { type: 'text', text: this.block }];
    // Copies isolate queued progress snapshots from later tool-result updates.
    return boundTimelineParts(parts).map((part) => Object.assign({}, part));
  }
}

/** Fold each parsed event once and discard its raw payload immediately.
 * Only bounded UI projections, accounting, and the latest result survive;
 * the daemon journal remains the source for rebuilding a later window. */
export class HarnessProjection {
  private readonly deltas = new Transcript();
  private readonly blocks = new Transcript();
  private streamsDeltas = false;
  eventCount = 0;
  outputTokens = 0;
  ended: Extract<HarnessEvent, { type: 'turn-ended' }> | undefined;
  agentSessionId: string | undefined;

  get text(): string {
    return this.deltas.text || this.blocks.text;
  }

  timeline(): TimelinePart[] {
    return (this.streamsDeltas ? this.deltas : this.blocks).snapshot();
  }

  feed(event: HarnessEvent): void {
    this.eventCount++;
    switch (event.type) {
      case 'text-delta':
        this.streamsDeltas = true;
        this.deltas.append(event.text, '');
        break;
      case 'text':
        this.blocks.append(event.text, '\n\n');
        break;
      case 'tool-use': {
        const input = clampValue(event.input);
        const part: TimelinePart = {
          type: `tool-${event.toolName}`,
          toolCallId: event.toolUseId,
          state: 'input-available',
          ...(input !== undefined ? { input } : {}),
        };
        this.deltas.tool(part);
        this.blocks.tool(part);
        break;
      }
      case 'tool-result': {
        const output = clampValue(event.output);
        const patch: Partial<TimelinePart> =
          event.isError === true
            ? {
                state: 'output-error',
                errorText:
                  typeof output === 'string' ? output : JSON.stringify(output),
              }
            : {
                state: 'output-available',
                ...(output !== undefined ? { output } : {}),
              };
        this.deltas.result(event.toolUseId, patch);
        this.blocks.result(event.toolUseId, patch);
        break;
      }
      case 'turn-ended':
        this.ended = event;
        this.agentSessionId ??= event.sessionId;
        break;
      case 'turn-started':
        this.agentSessionId ??= event.sessionId;
        break;
      case 'usage':
        this.outputTokens += event.outputTokens;
        break;
      default:
        break;
    }
  }
}
