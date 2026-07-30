'use client';

/**
 * The thought timeline — the 0.3 chat page's step view, restored for the
 * tool loop.
 *
 * Everything the model DID before its answer lives here, in the order it
 * happened: reasoning segments and tool steps interleaved exactly as the
 * turn's parts were authored. The header carries the live "Thinking" state
 * and latches to "Thought for Ns" (the same honest local measure the old
 * thinking section used); while a tool call is still awaiting its result the
 * label names it instead, so the wait is attributed rather than silent.
 *
 * Tool STEPS are always visible — they are the record of what the assistant
 * reached for, the same standing the old chips had. Expansion (sticky,
 * user-controlled, never automatic) only reveals the reasoning prose between
 * them. The answer text never renders here; it stays below, clean.
 */

import {
  Brain,
  ChevronRight,
  FileText,
  Globe,
  Loader2,
  Search,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useEffect, useId, useRef, useState, type ComponentType } from 'react';

import { MarkdownContent } from '@/app/features/shared/markdown/markdown-renderer';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-utils';

import type { MessagePart } from '../types';
import { hostnameOf } from './source-cards';

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
      /** The structured failure's message, on a failed step. */
      readonly failureMessage?: string;
      readonly state: 'running' | 'done' | 'failed';
    };

/**
 * Fold the message's parts into timeline entries. Tool calls pair with their
 * result by call id; a call whose result has not arrived is `running` only
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
  const resultsByCall = new Map<string, unknown>();
  for (const part of parts) {
    if (part.type === 'tool-result')
      resultsByCall.set(part.callId, part.output);
  }

  const entries: TimelineEntry[] = [];
  let reasoningIndex = 0;
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
      const settled = resultsByCall.has(part.callId);
      const output = resultsByCall.get(part.callId);
      const detail = toolCallDetail(part.input);
      const failed = settled && toolResultFailed(output);
      const resultName =
        isRecord(output) && typeof output.filename === 'string'
          ? output.filename
          : undefined;
      const failureMessage =
        failed && isRecord(output) && typeof output.message === 'string'
          ? output.message
          : undefined;
      entries.push({
        kind: 'step',
        key: `step:${part.callId}`,
        tool: part.capabilityId,
        ...(detail !== undefined ? { detail } : {}),
        ...(resultName !== undefined ? { resultName } : {}),
        ...(failureMessage !== undefined ? { failureMessage } : {}),
        state: failed
          ? 'failed'
          : settled || !options.isStreaming
            ? 'done'
            : 'running',
      });
    }
  }

  const tail = options.liveReasoningTail;
  if (tail !== undefined && tail.length > 0) {
    entries.push({ kind: 'reasoning', key: 'reasoning:tail', text: tail });
  }
  return entries;
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

export function ThoughtTimeline({
  parts,
  reasoningText,
  active,
  isStreaming,
}: {
  /** The message's ordered parts — reasoning and tool steps render here. */
  parts: readonly MessagePart[];
  /** The combined reasoning (settled segments + live tail), when any. */
  reasoningText?: string;
  /** The model is still reasoning — no answer text has started. */
  active: boolean;
  /** The live turn is still writing this row. */
  isStreaming: boolean;
}) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);

  // Local elapsed measure: starts on the first ACTIVE render, latches when
  // the answer starts. A settled history row never had an active render, so
  // it shows the plain label instead of a fabricated duration.
  const startedAtRef = useRef<number | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState<number | null>(null);
  useEffect(() => {
    if (!active) return undefined;
    startedAtRef.current ??= Date.now();
    const tick = () => {
      const startedAt = startedAtRef.current;
      if (startedAt !== null) {
        setElapsedSeconds(
          Math.max(1, Math.round((Date.now() - startedAt) / 1000)),
        );
      }
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [active]);

  const entries = buildTimelineEntries(parts, {
    isStreaming,
    ...(liveReasoningTail(parts, reasoningText) !== undefined
      ? { liveReasoningTail: liveReasoningTail(parts, reasoningText) }
      : {}),
  });
  const steps = entries.filter((entry) => entry.kind === 'step');
  const hasReasoning = entries.some((entry) => entry.kind === 'reasoning');
  if (entries.length === 0) return null;

  // The humanized title — "Searching knowledge base for …", "Reading
  // example.com" — the same voice the 0.3 timeline spoke, shared by the row
  // and the live header.
  const stepTitle = (entry: Extract<TimelineEntry, { kind: 'step' }>) => {
    if (entry.tool === 'rag_search') {
      return t('thinking.searchingKnowledgeBase', {
        query: entry.detail ?? '',
      });
    }
    if (
      entry.tool === 'web_fetch' ||
      (entry.tool === 'rag_fetch' && entry.detail?.startsWith('http') === true)
    ) {
      return t('thinking.reading', {
        hostname:
          entry.detail !== undefined
            ? (hostnameOf(entry.detail) ?? entry.detail)
            : entry.tool,
      });
    }
    if (entry.tool === 'rag_fetch') {
      return t('thinking.readingDocument', {
        name: entry.resultName ?? entry.detail ?? entry.tool,
      });
    }
    return t('parts.toolCall', { tool: entry.tool });
  };

  const runningStep = isStreaming
    ? steps.findLast((step) => step.state === 'running')
    : undefined;
  const label = runningStep
    ? stepTitle(runningStep)
    : active
      ? t('thinking.label')
      : elapsedSeconds !== null
        ? t('thinking.done', { seconds: elapsedSeconds })
        : t('thinking.label');

  // The 0.3 step row: a flat icon+title line — a spinner while live, a
  // warning on error, otherwise the tool's family icon. No box, no border;
  // the title already names the work.
  const stepRow = (entry: Extract<TimelineEntry, { kind: 'step' }>) => {
    const Icon = TOOL_ICONS[entry.tool] ?? Wrench;
    return (
      <div key={entry.key} className="flex items-start gap-2 text-sm">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          {entry.state === 'running' ? (
            <Loader2
              aria-hidden
              className="text-muted-foreground size-3.5 animate-spin motion-reduce:animate-none"
            />
          ) : entry.state === 'failed' ? (
            <TriangleAlert aria-hidden className="text-destructive size-3.5" />
          ) : (
            <Icon aria-hidden className="text-muted-foreground size-3.5" />
          )}
        </span>
        <span className="flex min-w-0 flex-col">
          <span className="text-muted-foreground truncate">
            {stepTitle(entry)}
          </span>
          {entry.failureMessage !== undefined && (
            <span className="text-destructive/80 text-xs break-words">
              {entry.failureMessage}
            </span>
          )}
        </span>
      </div>
    );
  };

  return (
    <div className="my-2 w-full min-w-0">
      {hasReasoning ? (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          aria-expanded={expanded}
          aria-controls={expanded ? bodyId : undefined}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-sm font-medium transition-colors"
        >
          <ChevronRight
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <Brain className="size-3.5 shrink-0" aria-hidden="true" />
          <span>{label}</span>
          {active && (
            <span aria-hidden className="flex items-center gap-1">
              {[0, 1, 2].map((index) => (
                <span
                  key={index}
                  className="bg-muted-foreground/60 size-1 animate-pulse rounded-full motion-reduce:animate-none"
                  style={{ animationDelay: `${index * 150}ms` }}
                />
              ))}
            </span>
          )}
        </button>
      ) : null}

      {expanded && hasReasoning ? (
        // Expanded: the full interleave — reasoning prose (indented, like the
        // old thinking body) and steps in the order they happened.
        <div id={bodyId} className="mt-2 flex min-w-0 flex-col gap-2">
          {entries.map((entry) =>
            entry.kind === 'reasoning' ? (
              <div
                key={entry.key}
                className="border-border/60 text-muted-foreground ml-2 border-l pl-3 text-sm"
              >
                <MarkdownContent content={entry.text} />
              </div>
            ) : (
              stepRow(entry)
            ),
          )}
        </div>
      ) : steps.length > 0 ? (
        // Collapsed: the steps stay visible — they are the record of what
        // the assistant reached for; only the prose folds away.
        <div
          className={cn(
            'flex min-w-0 flex-col gap-1.5',
            hasReasoning && 'mt-2',
          )}
        >
          {steps.map((entry) => stepRow(entry))}
        </div>
      ) : null}
    </div>
  );
}
