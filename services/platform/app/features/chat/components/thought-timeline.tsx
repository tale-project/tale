'use client';

import { AnimatePresence, m } from 'framer-motion';
import {
  Brain,
  Check,
  ChevronRight,
  FileText,
  Globe,
  Image as ImageIcon,
  Loader2,
  Search,
  TriangleAlert,
  Wrench,
} from 'lucide-react';
import { useId, useLayoutEffect, useMemo, useRef, useState } from 'react';

import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  buildThoughtTimeline,
  type ThoughtStep,
} from '../utils/build-thought-timeline';
import { formatToolDetail } from '../utils/format-tool-detail';

interface ThoughtTimelineProps {
  /** The owning UIMessage's `parts` (live `activeMessage.parts` while
   *  streaming, or the persisted message's parts afterwards). */
  parts: readonly unknown[] | undefined;
  /** Whether the owning assistant message is still streaming. Drives the
   *  expanded/collapsed default and the live "Thinking…" header. */
  isStreaming: boolean;
  /** Pre-answer duration for the "Thought for Ns" summary. Prefer
   *  metadata.timeToFirstTokenMs; falls back to a live capture. */
  durationMs?: number;
  /** Whether the assistant has begun streaming its answer text. Once true the
   *  timeline collapses to a summary (Claude-style) even though the message is
   *  still streaming. Kept separate from `isStreaming` so multi-step turns
   *  (reasoning → tool → human-input → …) stay expanded across the gaps between
   *  steps instead of flickering open/closed. */
  hasAnswerStarted?: boolean;
}

/** lucide icon per tool family — falls back to a generic wrench. */
function toolIcon(toolName: string) {
  if (toolName === 'web') return Globe;
  if (toolName === 'rag_search') return Search;
  if (toolName === 'image') return ImageIcon;
  if (
    toolName === 'pdf' ||
    toolName === 'docx' ||
    toolName === 'pptx' ||
    toolName === 'excel'
  ) {
    return FileText;
  }
  return Wrench;
}

/**
 * Standalone "Thinking…" indicator (brain + label + bouncing dots). Used as the
 * live header inside the timeline and as the post-send gap affordance in the
 * message list before the assistant message exists.
 */
export function ThinkingIndicator({ className }: { className?: string }) {
  const { t } = useT('chat');
  // NOTE: intentionally NO role="status"/aria-live here. Both call sites render
  // inside the message list's role="log" aria-live="polite" region, and nesting
  // a second polite live region is spec-discouraged and risks a double
  // announcement — let the ancestor log own the announcement.
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-center gap-1.5 text-sm font-medium',
        className,
      )}
    >
      <Brain className="size-4" aria-hidden="true" />
      <span>{t('thoughtProcess.thinking')}</span>
      <ThinkingDots />
    </div>
  );
}

function ThinkingDots() {
  return (
    <span className="ml-0.5 inline-flex space-x-1" aria-hidden="true">
      <span className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
      <span
        className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
        style={{ animationDelay: '0.1s' }}
      />
      <span
        className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
        style={{ animationDelay: '0.2s' }}
      />
    </span>
  );
}

function ToolStepRow({
  step,
}: {
  step: Extract<ThoughtStep, { kind: 'tool' }>;
}) {
  const { t } = useT('chat');
  const Icon = toolIcon(step.toolName);
  const { displayText } = formatToolDetail(t, step.toolName, step.input);
  const isActive =
    step.state === 'input-streaming' || step.state === 'input-available';
  const isError = step.state === 'output-error';

  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {isActive ? (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        ) : isError ? (
          <TriangleAlert className="text-destructive size-3.5" />
        ) : (
          <Check className="text-success size-3.5" />
        )}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={cn('flex items-center gap-1.5', 'text-foreground')}>
          <Icon className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">{displayText}</span>
        </span>
        {isError && step.errorText && (
          <span className="text-destructive/80 text-xs break-words">
            {step.errorText}
          </span>
        )}
      </span>
    </div>
  );
}

function ReasoningStepRow({
  step,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
}) {
  const { t } = useT('chat');
  if (step.redacted) {
    return (
      <p className="text-muted-foreground text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }
  return (
    <p className="text-muted-foreground text-sm break-words whitespace-pre-wrap">
      {step.text}
    </p>
  );
}

function StepNode({ step }: { step: ThoughtStep }) {
  return (
    <>
      {/* timeline node dot, sitting on the connector line */}
      <span
        className="bg-border ring-background absolute top-1.5 left-0 size-2 rounded-full ring-2"
        aria-hidden="true"
      />
      {step.kind === 'reasoning' ? (
        <ReasoningStepRow step={step} />
      ) : (
        <ToolStepRow step={step} />
      )}
    </>
  );
}

/**
 * Renders the assistant's thought process (reasoning blocks + tool activity)
 * as a chronological timeline. Live and expanded while the message streams,
 * then collapses to a one-line "Thought for Ns · used N tools" summary that
 * persists in history and can be re-expanded.
 *
 * Steps are keyed by stable id (NOT a content-derived key) so growing
 * reasoning text mutates an existing node rather than remounting — this is the
 * fix for the old ThinkingAnimation's jumping.
 */
export function ThoughtTimeline({
  parts,
  isStreaming,
  durationMs,
  hasAnswerStarted = false,
}: ThoughtTimelineProps) {
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();
  const stepsId = useId();

  const timeline = useMemo(() => buildThoughtTimeline(parts), [parts]);

  // `active` = the message is still streaming. Use the message-level signal
  // ONLY — it's the authoritative whole-turn flag (latched true through
  // tool/inter-step gaps in use-message-processing), so the step list stays
  // open for the ENTIRE stream (constant height, no mid-write shift) and
  // collapses once the turn ends. We deliberately do NOT OR in
  // `timeline.isStreaming`: an aborted/errored turn can leave a tool part stuck
  // at `input-available`, which would otherwise keep `active` true forever on a
  // finished history message (spinner spinning, never collapses).
  const active = isStreaming;
  // `thinking` = active and the answer hasn't started → pulsing "Thinking…"
  // header. Once the answer streams it becomes a static header (same height, so
  // the swap doesn't shift anything) while the steps stay expanded.
  const thinking = active && !hasAnswerStarted;

  // Collapsed by default after the turn ends; the user can expand. Forced open
  // while active so the height is constant during the whole stream.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = active ? true : (userToggled ?? false);

  // Live "thinking duration" fallback before metadata lands. Captured across
  // the thinking window (first thought → answer starts), so it approximates
  // metadata.timeToFirstTokenMs rather than the full message duration —
  // keeping the "Thought for Ns" summary stable when metadata replaces it.
  const startRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);
  // useLayoutEffect (not useEffect): captures the duration BEFORE paint so the
  // static summary header renders "Thought for Ns" in the first frame after the
  // answer starts, instead of painting one frame of "Used N tools" then swapping.
  useLayoutEffect(() => {
    if (thinking && startRef.current === null) {
      startRef.current = Date.now();
    }
    if (prevThinkingRef.current && !thinking && startRef.current !== null) {
      setLiveDurationMs(Date.now() - startRef.current);
    }
    prevThinkingRef.current = thinking;
  }, [thinking]);

  // No reasoning or tool activity → render no chrome (plain answer).
  if (timeline.steps.length === 0) return null;

  const effectiveDurationMs = durationMs ?? liveDurationMs ?? undefined;
  const seconds =
    effectiveDurationMs != null
      ? Math.max(1, Math.round(effectiveDurationMs / 1000))
      : undefined;

  const summaryText = (() => {
    if (seconds != null && timeline.toolCount > 0) {
      return t('thoughtProcess.summary', {
        seconds,
        tools: timeline.toolCount,
      });
    }
    if (seconds != null) return t('thoughtProcess.summaryNoTools', { seconds });
    if (timeline.toolCount > 0) {
      return t('thoughtProcess.summaryUnknownDuration', {
        tools: timeline.toolCount,
      });
    }
    return t('thoughtProcess.summaryReasoningOnly');
  })();

  const stepList = (
    <ul
      id={stepsId}
      className="border-border/60 mt-2 ml-1.5 flex flex-col gap-2 border-l pl-2"
    >
      <AnimatePresence initial={false}>
        {timeline.steps.map((step) =>
          prefersReducedMotion ? (
            <li key={step.id} className="relative pl-5">
              <StepNode step={step} />
            </li>
          ) : (
            // NOTE: deliberately NO `layout` prop. With `layout`, framer
            // animates every height change — including the reasoning text
            // growing/wrapping to a new line as it streams — which reads as a
            // short layout shift on each new line. Steps only ever append at
            // the bottom, so a plain opacity+translate enter (both composited,
            // never reflow) is shift-free; new lines just grow the box.
            <m.li
              key={step.id}
              initial={{ opacity: 0, y: 2 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.2, ease: [0.25, 0.1, 0.25, 1] }}
              className="relative pl-5"
            >
              <StepNode step={step} />
            </m.li>
          ),
        )}
      </AnimatePresence>
    </ul>
  );

  return (
    <div className="mb-3">
      {thinking ? (
        // Thinking, no answer yet: pulsing live header.
        <ThinkingIndicator />
      ) : active ? (
        // Answering (or tools still resolving) but thinking done: a STATIC,
        // same-height header. The steps stay expanded and at a constant height
        // so the streaming answer below them never shifts.
        <div className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          <Brain className="size-4" aria-hidden="true" />
          <span>{summaryText}</span>
        </div>
      ) : (
        // Turn finished: collapsible summary (collapsed by default, persists).
        <button
          type="button"
          onClick={() => setUserToggled(!expanded)}
          aria-expanded={expanded}
          aria-controls={stepsId}
          className="text-muted-foreground hover:text-foreground flex items-center gap-1 text-sm transition-colors"
        >
          <ChevronRight
            className={cn(
              'size-3.5 transition-transform',
              expanded && 'rotate-90',
            )}
            aria-hidden="true"
          />
          <Brain className="size-3.5" aria-hidden="true" />
          <span>{summaryText}</span>
        </button>
      )}
      {/* Steps render instantly (no height animation): expanded for the entire
          active turn — constant height, no mid-write shift — then collapsed once
          the turn ends. The single collapse happens after the answer is done. */}
      {expanded && stepList}
    </div>
  );
}
