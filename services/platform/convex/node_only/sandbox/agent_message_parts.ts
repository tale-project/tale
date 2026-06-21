// Maps an external-agent (Claude Code / OpenCode) turn's full event timeline to
// the AI-SDK assistant-message `content` parts that @convex-dev/agent persists.
// On read, listUIMessages/toUIMessages merges the tool-call+tool-result parts by
// toolCallId into the `tool-<name>` UI parts the chat history renderer already
// shows — so a completed turn's tool calls (command + output) survive in history,
// not just the live (capped, ephemeral) op buffer.
//
// This is the ModelMessage CONTENT shape — distinct from the frontend
// build-external-agent-parts.ts (UI-part shape used for the live op view).

import type { vAssistantContent } from '@convex-dev/agent/validators';
import type { Infer } from 'convex/values';

import type { AgentEvent } from '../../../lib/agent-adapters/events';

/**
 * The assistant-message `content` shape @convex-dev/agent persists + validates
 * (saveMessage / updateMessage / listUIMessages all speak this). Unified on the
 * agent component's own validator type rather than AI-SDK's wider
 * `AssistantContent` (which carries variants like ToolApprovalRequest the agent
 * validator rejects) so the durable-persistence chain typechecks without casts.
 */
export type AgentAssistantContent = Infer<typeof vAssistantContent>;

// Per-tool-output cap so a giant clone/diff/file-read can't push the persisted
// message past Convex's 1 MB document limit. The live view clamps display
// separately; this bounds what we store.
const MAX_OUTPUT_CHARS = 16_000;

// Per-MESSAGE cap (the whole assistant message doc). A long task accumulates an
// unbounded NUMBER of tool-call parts; once a segment approaches this, the run
// hands off to a continuation that opens a FRESH message (see S4 segmentation).
// Safely under Convex's 1 MB doc cap to leave room for the patch envelope.
export const MAX_MESSAGE_BYTES = 700_000;

// Per-Task cap on the FOLDED sub-agent step list. A single sub-agent can issue
// hundreds of tool calls; without a ceiling one runaway Task could blow the doc
// cap on its own. Generous (folding already shrinks the doc dramatically) but
// bounded — overflow drops the tail and records the count.
const MAX_SUBSTEPS_BYTES = 200_000;

/** One sub-agent tool call, folded under its parent Task's tool-result. The
 * persisted shape the timeline reads from `output.value.steps`; mirrors the
 * frontend `SubAgentStep` so the renderer needs no transform. */
export interface SubAgentStepData {
  toolName: string;
  input?: unknown;
  /** Clamped, stringified tool output (display-only). */
  output?: string;
  isError?: boolean;
}

/** The folded `output.value` shape on a Task tool-result that ran sub-agents:
 * the sub-agent's final report (rendered as markdown) plus its tool steps. */
export interface SubAgentActivity {
  report: string;
  steps: SubAgentStepData[];
  /** Count of steps dropped from the tail to satisfy MAX_SUBSTEPS_BYTES. */
  truncatedSteps?: number;
}

/** Serialized byte size of assistant content (tool inputs + JSON outputs, not
 * just text) — the basis for the per-message segmentation guard. */
export function estimateContentBytes(content: AgentAssistantContent): number {
  return typeof content === 'string'
    ? Buffer.byteLength(content, 'utf8')
    : Buffer.byteLength(JSON.stringify(content), 'utf8');
}

function clamp(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? `${text.slice(0, MAX_OUTPUT_CHARS)}\n… (truncated)`
    : text;
}

function stringifyOutput(output: unknown): string {
  if (typeof output === 'string') return output;
  if (output === undefined || output === null) return '';
  try {
    return JSON.stringify(output);
  } catch {
    // JSON.stringify only throws on a circular ref / BigInt — output is a
    // non-serializable object here, so String() would just yield
    // "[object Object]"; a marker is more honest than that.
    return '[unserializable output]';
  }
}

/** A sub-agent's report is rendered as MARKDOWN under its Task card, so pull out
 * readable text: a plain string, or the joined `text` of a tool_result content
 * array (`[{type:'text',text}]`). Falls back to a JSON dump for odd shapes. */
function extractResultText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (Array.isArray(output)) {
    const texts = output
      .map((b: unknown) =>
        b !== null &&
        typeof b === 'object' &&
        'text' in b &&
        typeof b.text === 'string'
          ? b.text
          : '',
      )
      .filter((t) => t !== '');
    if (texts.length > 0) return texts.join('\n');
  }
  return stringifyOutput(output);
}

/** Bound a Task's folded step list to MAX_SUBSTEPS_BYTES, dropping the tail and
 * recording how many were dropped — a runaway sub-agent can't blow the doc cap.*/
function capSubAgentActivity(activity: SubAgentActivity): SubAgentActivity {
  if (
    Buffer.byteLength(JSON.stringify(activity.steps), 'utf8') <=
    MAX_SUBSTEPS_BYTES
  ) {
    return activity;
  }
  const steps = [...activity.steps];
  let dropped = 0;
  while (
    steps.length > 0 &&
    Buffer.byteLength(JSON.stringify(steps), 'utf8') > MAX_SUBSTEPS_BYTES
  ) {
    steps.pop();
    dropped++;
  }
  return { report: activity.report, steps, truncatedSteps: dropped };
}

/**
 * Build the assistant message content from the turn's ordered timeline events.
 * `tool-use` → tool-call part, `tool-result` → tool-result part (paired by
 * toolUseId so toUIMessages merges them into a `tool-<name>` UI part), and the
 * agent's `text` blocks → text parts (the assistant's own words / the reply —
 * NOT reasoning, so they render once as the message body, not duplicated into a
 * "Thinking" block). `finalText` is appended only when the stream's last text
 * block didn't already produce it (e.g. a tool-only turn), avoiding duplication.
 *
 * SUB-AGENT FOLDING: events emitted by a sub-agent (the agent's own Task/Agent
 * tool — `parentToolUseId` set) are NOT emitted as top-level parts. Their text
 * is dropped (the sub-agent's final report survives as the parent Task's
 * tool-result) and their tool calls are folded into that Task tool-result's
 * `output` as `{ type:'json', value:{ report, steps } }` — the one channel
 * `toUIMessages` preserves verbatim — so the timeline can nest the sub-agent's
 * activity under its Task card instead of flattening hundreds of cards + full
 * markdown reports into the parent message. A sub-sub-agent's events fold into
 * their nearest TOP-LEVEL Task ancestor (one visible nesting level for v1).
 *
 * Returns a plain string when the turn made no tool calls (a trivial turn is
 * just its answer text).
 */
export function buildAssistantContent(
  events: readonly AgentEvent[],
  finalText: string,
  // toolUseId → toolName seed carried across S4 segment seams: a long tool
  // call (parallel subagents especially) issues its tool-use in one segment
  // and lands its result in a later one, whose own timeline never saw the
  // use — without the seed those orphan results all render as a bare "Tool".
  knownToolNames?: ReadonlyMap<string, string>,
  // childToolUseId → immediate parentToolUseId seed, carried across the same
  // seam so a sub-agent tool-result landing in a later segment still resolves
  // to its top-level Task ancestor (mirrors knownToolNames).
  knownToolParents?: ReadonlyMap<string, string>,
  // Live in-progress MAIN-agent text: the currently-open text block accumulated
  // from `text-delta` partials that haven't coalesced into a complete `text`
  // event yet. Threaded by the streaming flush so a long answer reveals as it
  // streams (and a mid-write Stop keeps it) instead of appearing only at block
  // end. The caller clears it the instant the block's `text` event lands in
  // `events`, so a completed block is never double-counted. Empty at terminal.
  liveText: string = '',
): AgentAssistantContent {
  const hasToolTimeline = events.some(
    (e) => e.type === 'tool-use' || e.type === 'tool-result',
  );
  // No tools → the message is just its answer; keep it a plain string.
  // `finalText` (set at the terminal `result`) is authoritative when present.
  // While streaming it's empty, so fall back to the main-agent text so far —
  // the closed `text` blocks plus the open `liveText` — so a plain answer
  // renders incrementally and survives a mid-write Stop instead of staying
  // blank until the turn ends.
  if (!hasToolTimeline) {
    if (finalText.trim() !== '') return finalText;
    const streamed: string[] = [];
    for (const e of events) {
      if (e.type === 'text' && !e.parentToolUseId && e.text.trim() !== '') {
        streamed.push(e.text);
      }
    }
    if (liveText.trim() !== '') streamed.push(liveText);
    return streamed.join('\n\n');
  }

  const parts: Exclude<AgentAssistantContent, string> = [];
  // toolUseId → toolName, so a tool-result (which carries no toolName) pairs
  // with its call under the same name for toUIMessages' merge.
  const toolNames = new Map<string, string>(knownToolNames);

  // childToolUseId → immediate parent tool-use id, learned from this segment's
  // sub-agent tool-uses plus the cross-seam seed. Walked to find the top-level
  // Task each sub-agent event belongs to.
  const toolParents = new Map<string, string>(knownToolParents);
  for (const e of events) {
    if (e.type === 'tool-use' && e.parentToolUseId) {
      toolParents.set(e.toolUseId, e.parentToolUseId);
    }
  }
  /** Walk `parentId` up to the top-level Task tool-use id (the one with no
   * parent). `undefined` ⇒ a main-agent event. Depth-capped against cycles. */
  const rootTaskOf = (parentId: string | undefined): string | undefined => {
    let cur = parentId;
    for (let depth = 0; cur !== undefined && depth < 8; depth++) {
      const next = toolParents.get(cur);
      if (next === undefined) return cur;
      cur = next;
    }
    return cur;
  };

  // rootTaskToolUseId → ordered folded sub-agent steps; plus a by-use-id index
  // so a sub-agent tool-result fills the step its tool-use opened.
  const subSteps = new Map<string, SubAgentStepData[]>();
  const stepByUseId = new Map<string, SubAgentStepData>();
  // rootTaskToolUseId → last sub-agent text (report fallback when the Task
  // tool-result content is empty).
  const lastSubText = new Map<string, string>();
  const pushStep = (root: string, step: SubAgentStepData): void => {
    const list = subSteps.get(root);
    if (list) list.push(step);
    else subSteps.set(root, [step]);
  };

  let lastText: string | undefined;

  for (const e of events) {
    if (e.type === 'text') {
      const root = rootTaskOf(e.parentToolUseId);
      if (root !== undefined) {
        // Sub-agent narration: dropped from the body. Keep the latest as the
        // report fallback if the Task result comes back empty.
        if (e.text.trim() !== '') lastSubText.set(root, e.text);
        continue;
      }
      if (e.text.trim() === '') continue;
      parts.push({ type: 'text', text: e.text });
      lastText = e.text;
    } else if (e.type === 'tool-use') {
      toolNames.set(e.toolUseId, e.toolName);
      const root = rootTaskOf(e.parentToolUseId);
      if (root !== undefined) {
        // Sub-agent tool call → fold under its top-level Task instead of
        // emitting a top-level card.
        const step: SubAgentStepData = { toolName: e.toolName, input: e.input };
        stepByUseId.set(e.toolUseId, step);
        pushStep(root, step);
        continue;
      }
      parts.push({
        type: 'tool-call',
        toolCallId: e.toolUseId,
        toolName: e.toolName,
        input: e.input,
        providerExecuted: true,
      });
    } else if (e.type === 'tool-result') {
      const root = rootTaskOf(e.parentToolUseId);
      if (root !== undefined) {
        // Sub-agent tool result → fill the step its use opened (or, if the use
        // was in a prior segment, append a result-only step).
        const existing = stepByUseId.get(e.toolUseId);
        if (existing) {
          existing.output = clamp(stringifyOutput(e.output));
          if (e.isError) existing.isError = true;
        } else {
          pushStep(root, {
            toolName: toolNames.get(e.toolUseId) ?? 'tool',
            output: clamp(stringifyOutput(e.output)),
            ...(e.isError ? { isError: true } : {}),
          });
        }
        continue;
      }
      // Main-agent tool result. If this is a Task that ran sub-agents, fold
      // their steps + the report into a json output the timeline nests.
      const folded = subSteps.get(e.toolUseId);
      if (folded && folded.length > 0) {
        const reportRaw = extractResultText(e.output);
        const report = clamp(
          reportRaw.trim() !== ''
            ? reportRaw
            : (lastSubText.get(e.toolUseId) ?? reportRaw),
        );
        parts.push({
          type: 'tool-result',
          toolCallId: e.toolUseId,
          toolName: toolNames.get(e.toolUseId) ?? 'tool',
          output: {
            type: 'json',
            value: capSubAgentActivity({ report, steps: folded }),
          },
          // Preserve the Task-level error signal: folding the sub-agent steps
          // into a json output would otherwise drop it, and toUIMessages reads
          // the part-level `isError` (not output.type) to render the failure.
          ...(e.isError ? { isError: true } : {}),
        });
        continue;
      }
      const value = clamp(stringifyOutput(e.output));
      parts.push({
        type: 'tool-result',
        toolCallId: e.toolUseId,
        toolName: toolNames.get(e.toolUseId) ?? 'tool',
        output: e.isError
          ? { type: 'error-text', value }
          : { type: 'text', value },
        // toUIMessages keys the error styling off the part-level `isError`, not
        // output.type, so set it here too or a failed tool renders as success.
        ...(e.isError ? { isError: true } : {}),
      });
    }
  }

  // Open (still-streaming) main-agent text block: not yet coalesced into a
  // `text` event, so render it as a trailing text part. The caller clears it
  // the instant its `text` event lands (which the loop above already emitted as
  // a part), so a completed block is never duplicated. Empty at terminal.
  if (liveText.trim() !== '') {
    parts.push({ type: 'text', text: liveText });
    lastText = liveText;
  }

  // Ensure the final answer is present exactly once (the stream usually already
  // emitted it as the last text block; append only if it didn't). Dedupe on the
  // TRIMMED values: the final-result text and the streamed last block often
  // differ only by trailing whitespace/newlines, which would otherwise slip the
  // `!==` check and duplicate the whole answer in the bubble.
  if (
    finalText.trim() !== '' &&
    finalText.trim() !== (lastText?.trim() ?? '')
  ) {
    parts.push({ type: 'text', text: finalText });
  }
  return parts;
}

// --- live workflow-run transcript --------------------------------------------
// A WORKFLOW sandbox step has no chat message to render its live timeline from
// (the chat path renders from the persisted assistant message). So we project
// the SAME folded timeline into the AI-SDK UI-PART shape `buildMessageSegments`
// reads (text / `tool-<name>` parts, sub-agents folded onto the Task's output),
// store a bounded tail on the live op, and the run view renders it with the
// shared `thought-timeline` rows — no second renderer, no message doc.

/** A UI part the live run-view timeline reads: a text run or a merged tool part
 *  (`type: 'tool-<name>'`). Mirrors what `toUIMessages` yields on the chat path,
 *  built directly here since a workflow run has no message to merge from. */
export type UiTimelinePart =
  | { type: 'text'; text: string; state: 'streaming' | 'done' }
  | {
      /** `tool-<toolName>`. */
      type: string;
      state:
        | 'input-streaming'
        | 'input-available'
        | 'output-available'
        | 'output-error';
      toolCallId: string;
      input?: unknown;
      output?: unknown;
      errorText?: string;
    };

// The op can't segment like a chat message (it's one row, capped near 1 MB), so
// the live transcript keeps only a recent window. Generous enough to read the
// flow, bounded so a 100-turn run never blows the doc.
const MAX_LIVE_TIMELINE_PARTS = 60;
const MAX_LIVE_TIMELINE_BYTES = 256_000;

// The CROSS-SEGMENT window persisted on the op across a durable run's segment
// seams. Larger than the per-segment caps (which bound one action window) so a
// refresh after a handoff still shows prior work, but kept well under Convex's
// 1 MB doc cap once `progressText` (~8 KB) + scalar fields are added.
export const MAX_LIVE_TIMELINE_PERSIST_PARTS = 240;
export const MAX_LIVE_TIMELINE_PERSIST_BYTES = 512_000;

/**
 * Bound a part list to a recent window, dropping the OLDEST parts to fit both
 * the count and byte caps and prepending a single "… N hidden" marker when
 * anything was dropped. Shared by the per-segment window ({@link capLiveParts})
 * and the cross-segment one ({@link capAccumulatedLiveParts}); the synthetic
 * marker is an ordinary text part, so a re-cap drops a stale one (it sorts
 * oldest, at the front) before adding a fresh one — no marker stacking.
 */
function capPartsWindow(
  parts: UiTimelinePart[],
  maxParts: number,
  maxBytes: number,
): UiTimelinePart[] {
  let kept = parts;
  let dropped = 0;
  if (kept.length > maxParts) {
    dropped += kept.length - maxParts;
    kept = kept.slice(-maxParts);
  } else {
    kept = [...kept];
  }
  while (
    kept.length > 1 &&
    Buffer.byteLength(JSON.stringify(kept), 'utf8') > maxBytes
  ) {
    kept.shift();
    dropped++;
  }
  if (dropped > 0) {
    kept.unshift({
      type: 'text',
      text: `… (${dropped} earlier step${dropped === 1 ? '' : 's'} hidden)`,
      state: 'done',
    });
  }
  return kept;
}

function capLiveParts(parts: UiTimelinePart[]): UiTimelinePart[] {
  return capPartsWindow(
    parts,
    MAX_LIVE_TIMELINE_PARTS,
    MAX_LIVE_TIMELINE_BYTES,
  );
}

/**
 * The op's cross-segment live transcript: the prior segments' parts (already on
 * the op) followed by THIS segment's window, kept to the most recent ~512 KB.
 * A durable agent run segments at the Convex action ceiling, and each segment
 * starts with an EMPTY per-segment timeline — so without accumulating here the
 * op would hold only the current segment, and a refresh after a seam (or while
 * the agent idles between segments, e.g. waiting on CI) would show nothing.
 * `current` is the already-bounded per-segment window, disjoint from `prior`
 * (the cross-seam carry is the cursor + tool maps, never timeline parts), so the
 * concatenation never double-counts. An empty `current` returns `prior` intact.
 */
export function capAccumulatedLiveParts(
  prior: readonly UiTimelinePart[],
  current: readonly UiTimelinePart[],
): UiTimelinePart[] {
  return capPartsWindow(
    [...prior, ...current],
    MAX_LIVE_TIMELINE_PERSIST_PARTS,
    MAX_LIVE_TIMELINE_PERSIST_BYTES,
  );
}

/**
 * Project a turn's timeline into a bounded list of live UI parts for the run
 * view. Reuses {@link buildAssistantContent} for ALL the folding/clamping, then
 * merges its tool-call+tool-result pairs into the single `tool-<name>` UI parts
 * the segment builder expects (a tool with no result yet stays `input-available`,
 * so it renders as in-flight). Same args as `buildAssistantContent`.
 */
export function buildUiPartsFromTimeline(
  events: readonly AgentEvent[],
  finalText: string,
  knownToolNames?: ReadonlyMap<string, string>,
  knownToolParents?: ReadonlyMap<string, string>,
  liveText: string = '',
): UiTimelinePart[] {
  const content = buildAssistantContent(
    events,
    finalText,
    knownToolNames,
    knownToolParents,
    liveText,
  );
  if (typeof content === 'string') {
    if (content.trim() === '') return [];
    return [
      {
        type: 'text',
        text: content,
        // The open trailing block is still streaming while liveText is set.
        state: liveText.trim() !== '' ? 'streaming' : 'done',
      },
    ];
  }

  const parts: UiTimelinePart[] = [];
  const toolIndex = new Map<string, number>(); // toolCallId → index in `parts`
  for (const part of content) {
    if (part.type === 'text') {
      parts.push({ type: 'text', text: part.text, state: 'done' });
    } else if (part.type === 'tool-call') {
      toolIndex.set(part.toolCallId, parts.length);
      parts.push({
        type: `tool-${part.toolName}`,
        state: 'input-available',
        toolCallId: part.toolCallId,
        input: part.input,
      });
    } else if (part.type === 'tool-result') {
      const out = part.output;
      // buildAssistantContent wraps outputs as {type:'text'|'error-text'|'json', value}.
      const isError =
        part.isError === true ||
        (out !== null && typeof out === 'object' && out.type === 'error-text');
      const value =
        out !== null && typeof out === 'object' && 'value' in out
          ? out.value
          : out;
      const idx = toolIndex.get(part.toolCallId);
      // Carry the input forward from the matching tool-call part (if any).
      const callPart = idx !== undefined ? parts[idx] : undefined;
      const input =
        callPart && 'toolCallId' in callPart ? callPart.input : undefined;
      const merged: UiTimelinePart = {
        type: `tool-${part.toolName}`,
        state: isError ? 'output-error' : 'output-available',
        toolCallId: part.toolCallId,
        output: value,
        ...(input !== undefined && { input }),
        ...(isError && typeof value === 'string' && { errorText: value }),
      };
      if (idx !== undefined) parts[idx] = merged;
      else parts.push(merged);
    }
  }
  return capLiveParts(parts);
}
