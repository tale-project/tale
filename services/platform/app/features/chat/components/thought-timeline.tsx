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
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

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
  /** Total tokens for the finished turn (metadata.totalTokens ?? outputTokens).
   *  Absent while streaming — the header omits the token segment until the
   *  metadata lands at turn completion. */
  tokenCount?: number;
  /** Whether the assistant has begun streaming its answer text. Drives the
   *  live "Thinking …" header vs. the static summary. Kept separate from
   *  `isStreaming` so multi-step turns (reasoning → tool → human-input → …)
   *  don't flip the header label across the gaps between steps. */
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
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'tool' }>;
  /** Whether the OWNING message is still streaming. A tool stuck at
   *  input-available on a finished/aborted turn must NOT show a live spinner. */
  active: boolean;
}) {
  const { t } = useT('chat');
  const Icon = toolIcon(step.toolName);
  const { displayText } = formatToolDetail(t, step.toolName, step.input);
  const isActive =
    active &&
    (step.state === 'input-streaming' || step.state === 'input-available');
  const isError = step.state === 'output-error';
  const isComplete = step.state === 'output-available';

  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        {isActive ? (
          <Loader2 className="text-muted-foreground size-3.5 animate-spin" />
        ) : isError ? (
          <TriangleAlert className="text-destructive size-3.5" />
        ) : isComplete ? (
          <Check className="text-success size-3.5" />
        ) : (
          // Non-active and never reached a terminal state (e.g. aborted
          // mid-call, left stuck at input-available). Show a MUTED check, not
          // the green success check, so it isn't mislabeled as succeeded.
          <Check className="text-muted-foreground size-3.5" />
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

function StepNode({ step, active }: { step: ThoughtStep; active: boolean }) {
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
        <ToolStepRow step={step} active={active} />
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
  tokenCount,
  hasAnswerStarted = false,
}: ThoughtTimelineProps) {
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();
  const stepsId = useId();

  const timeline = useMemo(() => buildThoughtTimeline(parts), [parts]);

  // `active` = the message is still streaming. Use the message-level signal
  // ONLY: an aborted/errored turn can leave a tool part stuck at
  // `input-available`, which would otherwise keep this true forever on a
  // finished history message (the live header never resolving to a summary).
  const active = isStreaming;
  // `thinking` = active and the answer hasn't started → live "Thinking …"
  // header with a ticking timer. Once the answer streams it becomes the static
  // "Thought for Ns · …" summary.
  const thinking = active && !hasAnswerStarted;

  // Collapsed by default in EVERY state — including while streaming. The user
  // can expand to watch the live reasoning. Keeping it collapsed by default
  // gives a constant one-line height (no mid-stream layout shift) and never
  // leaks the raw chain-of-thought of a blocked turn in the streamed-then-
  // blocked window.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = userToggled ?? false;

  // Thinking-window timing. `startRef` is stamped when thinking begins.
  // `liveElapsedMs` ticks every second for the live header; `liveDurationMs`
  // latches the final value the instant the answer starts, so the persisted
  // "Thought for Ns" summary stays stable until metadata.timeToFirstTokenMs
  // replaces it.
  const startRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);
  // useLayoutEffect (not useEffect): latches the duration BEFORE paint so the
  // static summary renders "Thought for Ns" in the first frame after the answer
  // starts, instead of painting one frame without a duration then swapping.
  useLayoutEffect(() => {
    if (thinking && startRef.current === null) {
      startRef.current = Date.now();
    }
    if (prevThinkingRef.current && !thinking && startRef.current !== null) {
      setLiveDurationMs(Date.now() - startRef.current);
    }
    prevThinkingRef.current = thinking;
  }, [thinking]);

  // Tick the live elapsed timer once a second while thinking. Scoped to the
  // thinking window and cleared on unmount, so finished bubbles carry no timer.
  useEffect(() => {
    if (!thinking) return undefined;
    if (startRef.current === null) startRef.current = Date.now();
    setLiveElapsedMs(Date.now() - startRef.current);
    const id = setInterval(() => {
      if (startRef.current !== null) {
        setLiveElapsedMs(Date.now() - startRef.current);
      }
    }, 1000);
    return () => clearInterval(id);
  }, [thinking]);

  // No reasoning or tool activity → render no chrome (plain answer).
  if (timeline.steps.length === 0) return null;

  const toSeconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

  // Build the "·"-separated meta row. While thinking: live elapsed seconds +
  // any tool/skill counts already visible in the parts (tokens are only known
  // post-turn, so they're omitted live). After the turn: the pre-answer
  // duration + tools + skills + total tokens — each segment included only when
  // its value is known.
  const segments: string[] = [];
  if (thinking) {
    if (liveElapsedMs != null) {
      segments.push(
        t('thoughtProcess.seconds', { seconds: toSeconds(liveElapsedMs) }),
      );
    }
  } else {
    const ms = durationMs ?? liveDurationMs ?? undefined;
    if (ms != null) {
      segments.push(
        t('thoughtProcess.durationLabel', { seconds: toSeconds(ms) }),
      );
    }
  }
  if (timeline.toolCount > 0) {
    segments.push(
      t('thoughtProcess.toolsCount', { count: timeline.toolCount }),
    );
  }
  if (timeline.skillCount > 0) {
    segments.push(
      t('thoughtProcess.skillsCount', { count: timeline.skillCount }),
    );
  }
  if (!thinking && tokenCount != null && tokenCount > 0) {
    segments.push(t('thoughtProcess.tokensCount', { count: tokenCount }));
  }

  const meta = segments.join(' · ');
  // While thinking, lead with the "Thinking" word + live stats. After the turn,
  // show the stats alone; if nothing is measurable fall back to the honest
  // reasoning-only label so the header is never empty.
  const headerText = thinking
    ? meta
      ? `${t('thoughtProcess.thinking')} · ${meta}`
      : t('thoughtProcess.thinking')
    : meta || t('thoughtProcess.summaryReasoningOnly');

  const stepList = (
    <ul
      id={stepsId}
      className="border-border/60 mt-2 ml-1.5 flex flex-col gap-2 border-l pl-2"
    >
      <AnimatePresence initial={false}>
        {timeline.steps.map((step) =>
          prefersReducedMotion ? (
            <li key={step.id} className="relative pl-5">
              <StepNode step={step} active={active} />
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
              <StepNode step={step} active={active} />
            </m.li>
          ),
        )}
      </AnimatePresence>
    </ul>
  );

  return (
    <div className="mb-3">
      {/* One collapsible header for every state (thinking / answering /
          finished): a chevron + brain + the live-or-final stat row. Collapsed
          by default; the user expands to reveal the step list. While thinking
          the bouncing dots signal live activity next to the ticking timer. */}
      <button
        type="button"
        onClick={() => setUserToggled(!expanded)}
        aria-expanded={expanded}
        // The <ul id={stepsId}> is only mounted while `expanded` ({expanded &&
        // stepList}); point aria-controls at it only when it exists so we don't
        // leave a dangling reference (flagged by axe aria-valid-attr-value).
        aria-controls={expanded ? stepsId : undefined}
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
        <span className="text-left">{headerText}</span>
        {thinking && <ThinkingDots />}
      </button>
      {expanded && stepList}
    </div>
  );
}
