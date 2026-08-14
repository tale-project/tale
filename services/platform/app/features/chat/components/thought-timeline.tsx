'use client';

/**
 * The thought timeline — the 0.3 chat page's step view, restored for the
 * tool loop.
 *
 * Everything the model DID before its answer lives here, in the order it
 * happened: reasoning segments and tool steps interleaved exactly as the
 * turn's parts were authored. The header keeps a STABLE "Thinking" verb for
 * the whole live phase, with the send-anchored seconds ticking beside it
 * pre-answer — it never mirrors the running tool's title (the 0.3 team
 * measured that flip as jitter; the running step's own spinner row below
 * attributes the wait). Once the turn settles the header stays, quieted to
 * "Thought for Ns" — the live count landing on its total, never vanishing
 * (counts beyond the duration belong to the message-info dialog, not a
 * chat reply).
 *
 * Tool STEPS are always visible — they are the record of what the assistant
 * reached for, the same standing the old chips had — and each row with
 * detail drills down to the call's full input and output. Expansion of the
 * header (sticky, user-controlled, never automatic) only reveals the
 * reasoning prose between them. The answer text never renders here; it stays
 * below, clean.
 */

import {
  Brain,
  FileText,
  Globe,
  Loader2,
  Search,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useId, useState, type ComponentType } from 'react';

import { TypewriterText } from '@/app/features/shared/markdown/typewriter-text';
import { isPausingChatTool } from '@/lib/chat/tools';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import type { MarkdownComponentMap } from '@/lib/utils/markdown-types';
import { isRecord } from '@/lib/utils/type-utils';

import {
  toSeconds,
  useThinkingTimer,
  type ThinkingAnchor,
} from '../hooks/use-thinking-timer';
import type { ChatMessageUsage, MessagePart } from '../types';
import { stepActivityLabel } from '../utils/activity-label';
import { ThinkingDots } from './thinking-dots';
import { TimelineRow } from './timeline-row';

/** The retrieval tools get their own glyphs; anything unknown keeps the
 * generic wrench. */
const TOOL_ICONS: Record<string, ComponentType<{ className?: string }>> = {
  rag_search: Search,
  rag_fetch: FileText,
  web_fetch: Globe,
};

/** What a tool was asked, for the step's detail: the retrieval tools carry
 * exactly one human-meaningful argument each. */
function toolCallDetail(input: unknown): string | undefined {
  if (!isRecord(input)) return undefined;
  for (const key of ['query', 'ref', 'url'] as const) {
    const value = input[key];
    if (typeof value === 'string' && value.length > 0) return value;
  }
  return undefined;
}

/** True when a structured tool result reports anything but success. */
function toolResultFailed(output: unknown): boolean {
  return (
    isRecord(output) &&
    typeof output.status === 'string' &&
    output.status !== 'ok'
  );
}

/**
 * Minimal markdown overrides for reasoning prose: tight, symmetric block
 * spacing with the FIRST block's top margin and the LAST block's bottom
 * margin zeroed, so the reasoning text's first line sits flush with its
 * indent rather than a line below it. Color/size are inherited from the row
 * wrapper. Deliberately tiny (just block spacing — no shiki / citations)
 * so the timeline stays decoupled from the heavy chat markdown renderer.
 */
const REASONING_MARKDOWN_COMPONENTS: MarkdownComponentMap = {
  p: ({ children }) => (
    <p className="my-2 leading-relaxed first:mt-0 last:mb-0">{children}</p>
  ),
  ul: ({ children }) => (
    <ul className="my-2 list-disc space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ul>
  ),
  ol: ({ children }) => (
    <ol className="my-2 list-decimal space-y-1 pl-5 first:mt-0 last:mb-0">
      {children}
    </ol>
  ),
};

/** One timeline entry, in authored order. */
type TimelineEntry =
  | { readonly kind: 'reasoning'; readonly key: string; readonly text: string }
  | {
      readonly kind: 'step';
      readonly key: string;
      readonly tool: string;
      /** The call's load-bearing argument (query / ref / url). */
      readonly detail?: string;
      /** The fetched document's filename, when the result named one. */
      readonly resultName?: string;
      /** The call's full arguments, for the drill-down body. */
      readonly input?: unknown;
      /** The call's full result, once it settled — the drill-down body. */
      readonly output?: unknown;
      readonly state: 'running' | 'done' | 'failed';
    };

/**
 * Fold the message's parts into timeline entries. Tool calls pair with their
 * result by call id — IN ORDER, because some providers reuse ids (`call_0`
 * every round), and a single map would clobber every earlier round's result
 * with the last one. A call whose result has not arrived is `running` only
 * while the turn still streams — on a settled row it reads as failed-silent
 * `done` (the turn ended; there is nothing to wait for).
 */
export function buildTimelineEntries(
  parts: readonly MessagePart[],
  options: {
    readonly isStreaming: boolean;
    readonly liveReasoningTail?: string;
  },
): TimelineEntry[] {
  const resultsByCall = new Map<string, unknown[]>();
  for (const part of parts) {
    if (part.type === 'tool-result') {
      const queue = resultsByCall.get(part.callId) ?? [];
      queue.push(part.output);
      resultsByCall.set(part.callId, queue);
    }
  }

  const entries: TimelineEntry[] = [];
  let reasoningIndex = 0;
  let stepIndex = 0;
  for (const part of parts) {
    if (part.type === 'reasoning' && part.text.length > 0) {
      entries.push({
        kind: 'reasoning',
        key: `reasoning:${reasoningIndex}`,
        text: part.text,
      });
      reasoningIndex += 1;
      continue;
    }
    if (part.type === 'tool-call') {
      // A tool whose whole purpose is to put something in front of the person
      // is drawn AS that thing, never as a step announcing it happened: the
      // `human-input` row below carries the question, the count and the
      // outcome, so "Asking question" was a placeholder sitting above a
      // strictly better row. Steps are for INVISIBLE work — a search or a
      // fetch, where the step is the only evidence any of it occurred.
      //
      // `isPausingChatTool` already means "addresses the person and ends the
      // turn", which is exactly the property that decides this, so there is no
      // second list to keep in sync.
      if (isPausingChatTool(part.capabilityId)) continue;
      const queue = resultsByCall.get(part.callId);
      const settled = queue !== undefined && queue.length > 0;
      const output = settled ? queue.shift() : undefined;
      const detail = toolCallDetail(part.input);
      const failed = settled && toolResultFailed(output);
      const resultName =
        isRecord(output) && typeof output.filename === 'string'
          ? output.filename
          : undefined;
      entries.push({
        kind: 'step',
        // Positional prefix: providers may reuse call ids across rounds
        // (`call_0` each step), and React keys must stay unique.
        key: `step:${stepIndex}:${part.callId}`,
        tool: part.capabilityId,
        ...(detail !== undefined ? { detail } : {}),
        ...(resultName !== undefined ? { resultName } : {}),
        input: part.input,
        ...(settled ? { output } : {}),
        state: failed
          ? 'failed'
          : settled || !options.isStreaming
            ? 'done'
            : 'running',
      });
      stepIndex += 1;
    }
  }

  const tail = options.liveReasoningTail;
  if (tail !== undefined && tail.length > 0) {
    entries.push({ kind: 'reasoning', key: 'reasoning:tail', text: tail });
  }
  return dropSupersededFailures(entries);
}

/** A malformed-call complaint the model can fix by rewriting its call — the
 * one failure kind supersession may hide. Every other status (`not_found`,
 * `unavailable`, `error`) is the OUTCOME of a well-formed call: real
 * information about the world, kept even when a later call succeeded. */
function isCorrectableFailure(output: unknown): boolean {
  return isRecord(output) && output.status === 'invalid_args';
}

/**
 * Drop a failed step that a LATER successful call of the same tool replaced.
 *
 * A model that gets a correctable error and immediately fixes its call has
 * not failed at anything the reader needs to know about — the search ran, the
 * question got asked. Showing the discarded attempt puts a red warning and a
 * schema complaint in the transcript for a turn that worked, which reads as
 * breakage and is the noisiest thing on the row.
 *
 * A failure with no later success is KEPT, because then something really was
 * lost and the reply may be worse for it. This hides a retry, never an
 * outcome — which is why only `invalid_args` qualifies: a `not_found` that a
 * later fetch recovered from still told the reader something true about that
 * round (the 0.3 `call_0` pairing pin).
 */
function dropSupersededFailures(entries: TimelineEntry[]): TimelineEntry[] {
  const recovered = new Set<string>();
  for (const entry of entries) {
    if (entry.kind === 'step' && entry.state === 'done') {
      recovered.add(entry.tool);
    }
  }
  if (recovered.size === 0) return entries;
  const seenDoneBefore = new Set<string>();
  return entries.filter((entry) => {
    if (entry.kind !== 'step') return true;
    if (entry.state === 'done') {
      seenDoneBefore.add(entry.tool);
      return true;
    }
    // Only a correctable failure that a later success replaced is hidden —
    // one that was already the last word on its tool stays.
    return !(
      entry.state === 'failed' &&
      isCorrectableFailure(entry.output) &&
      recovered.has(entry.tool) &&
      !seenDoneBefore.has(entry.tool)
    );
  });
}

/**
 * The live reasoning beyond what the parts already settled. The row's
 * combined reasoning is the settled segments joined with the live tail
 * (`thread-view-core`), so the tail is whatever extends past that join.
 */
export function liveReasoningTail(
  parts: readonly MessagePart[],
  combinedReasoning: string | undefined,
): string | undefined {
  if (combinedReasoning === undefined || combinedReasoning.length === 0) {
    return undefined;
  }
  const settled = parts
    .filter((part) => part.type === 'reasoning' && part.text.length > 0)
    .map((part) => (part.type === 'reasoning' ? part.text : ''))
    .join('\n\n');
  if (settled.length === 0) return combinedReasoning;
  if (!combinedReasoning.startsWith(settled)) return undefined;
  const tail = combinedReasoning.slice(settled.length);
  return tail.replace(/^\n+/, '') || undefined;
}

// Cap the expanded detail so a giant fetch result can't blow up the DOM; the
// scroll box shows the head and notes the truncation.
const TOOL_DETAIL_MAX = 4000;

function clampDetail(text: string): string {
  return text.length > TOOL_DETAIL_MAX
    ? `${text.slice(0, TOOL_DETAIL_MAX)}\n… (truncated)`
    : text;
}

/** Full input text for a step's expanded detail: the load-bearing string
 * argument verbatim, else a JSON dump of the args. Distinct from the
 * collapsed one-liner, which truncates. */
function toolInputText(input: unknown): string | undefined {
  const direct = toolCallDetail(input);
  if (direct !== undefined) return direct;
  if (!isRecord(input) || Object.keys(input).length === 0) return undefined;
  try {
    return JSON.stringify(input, null, 2);
  } catch (error) {
    console.warn('thought-timeline: unserializable tool input', error);
    return undefined;
  }
}

/** Output text for a step's expanded detail: a fetched page/document's
 * content verbatim, else the structured result as JSON. */
function toolOutputText(output: unknown): string | undefined {
  if (output === undefined || output === null) return undefined;
  if (typeof output === 'string') {
    return output.length > 0 ? output : undefined;
  }
  if (
    isRecord(output) &&
    typeof output.content === 'string' &&
    output.content.length > 0
  ) {
    return output.content;
  }
  try {
    return JSON.stringify(output, null, 2);
  } catch (error) {
    console.warn('thought-timeline: unserializable tool output', error);
    return undefined;
  }
}

/**
 * The 0.3 step row: a flat icon+title line — a spinner while live, a warning
 * on error, otherwise the tool's family icon. A row with detail is a
 * chevron-led toggle: expanding reveals the call's full input and output in
 * scrollable monospace blocks (the failure detail folds in while expanded,
 * since the output block carries it in full).
 */
function TimelineStepRow({
  entry,
  title,
}: {
  entry: Extract<TimelineEntry, { kind: 'step' }>;
  title: string;
}) {
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const Icon = TOOL_ICONS[entry.tool] ?? Wrench;
  const failed = entry.state === 'failed';
  const inputText = toolInputText(entry.input);
  const outputText = toolOutputText(entry.output);
  const hasDetail = inputText !== undefined || outputText !== undefined;

  const StateIcon =
    entry.state === 'running' ? Loader2 : failed ? TriangleAlert : Icon;

  return (
    <div className="flex min-w-0 flex-col">
      <TimelineRow
        icon={StateIcon}
        label={title}
        iconClassName={cn(
          entry.state === 'running' &&
            'animate-spin motion-reduce:animate-none',
          failed && 'text-destructive',
        )}
        {...(hasDetail
          ? {
              onToggle: () => setExpanded((value) => !value),
              expanded,
              controls: bodyId,
            }
          : {})}
      />
      <span className="flex min-w-0 flex-col">
        {expanded && hasDetail && (
          <div id={bodyId} className="mt-1 ml-4 flex flex-col gap-1.5">
            {inputText !== undefined && (
              <pre className="bg-muted/60 text-muted-foreground max-h-60 overflow-auto rounded p-2 text-xs whitespace-pre-wrap">
                {clampDetail(inputText)}
              </pre>
            )}
            {outputText !== undefined && (
              <pre
                className={cn(
                  'max-h-60 overflow-auto rounded p-2 text-xs whitespace-pre-wrap',
                  failed
                    ? 'bg-destructive/10 text-destructive/90'
                    : 'bg-muted/40 text-foreground/80',
                )}
              >
                {clampDetail(outputText)}
              </pre>
            )}
          </div>
        )}
      </span>
    </div>
  );
}

export function ThoughtTimeline({
  parts,
  reasoningText,
  active,
  isStreaming,
  usage,
  anchor,
}: {
  /** The message's ordered parts — reasoning and tool steps render here. */
  parts: readonly MessagePart[];
  /** The combined reasoning (settled segments + live tail), when any. */
  reasoningText?: string;
  /** The model is still pre-answer — reasoning or reaching for tools. */
  active: boolean;
  /** The live turn is still writing this row. */
  isStreaming: boolean;
  /** The persisted turn stats, for the settled summary. */
  usage?: ChatMessageUsage;
  /** The send-anchored clock the live timer counts from. */
  anchor?: ThinkingAnchor;
}) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);

  // The send-anchored thinking window: ticks every second while pre-answer,
  // latches the instant the answer starts. Anchored to the ROW (send moment /
  // server start), never to this mount, so a reload or the gap→header handoff
  // never resets the count.
  const { liveElapsedMs, liveDurationMs } = useThinkingTimer(anchor, active);

  const tail = liveReasoningTail(parts, reasoningText);
  const entries = buildTimelineEntries(parts, {
    isStreaming,
    ...(tail !== undefined ? { liveReasoningTail: tail } : {}),
  });
  const steps = entries.filter((entry) => entry.kind === 'step');
  const hasReasoning = entries.some((entry) => entry.kind === 'reasoning');
  if (entries.length === 0) return null;

  // Settled: the quiet "Thought for Ns" — a chat reply, not a dashboard;
  // tool and token counts live in the message-info dialog. The header STAYS
  // after settle (the ticking "Thinking · Ns" landing on "Thought for Ns"
  // reads as a settle, vanishing read as a glitch); it only hides on the
  // one dishonest combination — a tool-only turn with no measured duration,
  // where every candidate label would claim something that didn't happen.
  // Send → first words (perceivedWaitMs) is the send → first-paint duration the
  // watching browser stamped. TTFT is first provider text SSE — a turn
  // that wrote nothing never stamps it, and the header used to vanish on
  // a 28-second turn that had run three tools. `durationMs` is always
  // measured; for a turn with no answer the whole turn WAS the thinking.
  const settledDurationMs =
    liveDurationMs ??
    usage?.perceivedWaitMs ??
    usage?.timeToFirstTokenMs ??
    usage?.durationMs;
  const showHeader =
    isStreaming || hasReasoning || settledDurationMs !== undefined;

  // Live: the STABLE "Thinking" verb (+ the ticking seconds pre-answer). The
  // label never mirrors the running step — that flip read as random jitter in
  // 0.3 and the step rows below already attribute the wait.
  const label = isStreaming
    ? active && liveElapsedMs !== null
      ? `${t('thinking.label')} · ${t('thinking.seconds', {
          seconds: toSeconds(liveElapsedMs),
        })}`
      : t('thinking.label')
    : settledDurationMs !== undefined
      ? t('thinking.done', { seconds: toSeconds(settledDurationMs) })
      : t('thinking.summaryReasoningOnly');

  // The header is the SAME row as the steps under it. It used to carry its own
  // icon size, its own gap and `font-medium` — which is why it read as a
  // different kind of thing, and why the strip had three places for text to
  // start. Its chevron/spacer discipline moved into the shared row, so nothing
  // still shifts when reasoning arrives mid-stream.
  const headerLabel = <span data-testid="thought-timeline-label">{label}</span>;

  return (
    <div className="my-2 w-full min-w-0">
      {showHeader && (
        <TimelineRow
          icon={Brain}
          label={headerLabel}
          {...(isStreaming ? { trailing: <ThinkingDots /> } : {})}
          {...(hasReasoning
            ? {
                onToggle: () => setExpanded((value) => !value),
                expanded,
                controls: bodyId,
              }
            : {})}
        />
      )}

      {expanded && hasReasoning ? (
        // Expanded: the full interleave — reasoning prose (indented, like the
        // old thinking body, gliding through the same typewriter the answer
        // uses while live) and steps in the order they happened.
        <div id={bodyId} className="mt-2 flex min-w-0 flex-col gap-2">
          {entries.map((entry) =>
            entry.kind === 'reasoning' ? (
              <div
                key={entry.key}
                className="border-border/60 text-muted-foreground ml-2 border-l pl-3 text-sm"
              >
                <TypewriterText
                  text={entry.text}
                  isStreaming={isStreaming && entry.key === 'reasoning:tail'}
                  components={REASONING_MARKDOWN_COMPONENTS}
                />
              </div>
            ) : (
              <TimelineStepRow
                key={entry.key}
                entry={entry}
                title={stepActivityLabel(t, entry)}
              />
            ),
          )}
        </div>
      ) : steps.length > 0 ? (
        // Collapsed: the steps stay visible — they are the record of what
        // the assistant reached for; only the prose folds away.
        <div className="mt-2 flex min-w-0 flex-col gap-1.5">
          {steps.map((entry) => (
            <TimelineStepRow
              key={entry.key}
              entry={entry}
              title={stepActivityLabel(t, entry)}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}
