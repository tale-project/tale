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
  Waypoints,
  Wrench,
} from 'lucide-react';
import {
  useCallback,
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
import type { MarkdownComponentMap } from '@/lib/utils/markdown-types';

import type { ThoughtActivity } from '../utils/build-message-segments';
import {
  buildThoughtTimeline,
  type ThoughtStep,
} from '../utils/build-thought-timeline';
import { formatToolDetail } from '../utils/format-tool-detail';
import { type RouteReason, routeReasonLabel } from '../utils/route-reason';
import { TypewriterText } from './typewriter-text';

interface ThoughtTimelineProps {
  /** The owning UIMessage's `parts` (live `activeMessage.parts` while
   *  streaming, or the persisted message's parts afterwards). */
  parts: readonly unknown[] | undefined;
  /** Whether the owning assistant message is still streaming. Drives the
   *  expanded/collapsed default and the live "Thinking…" header. */
  isStreaming: boolean;
  /** Persisted pre-answer wall-clock for the "Thought for Ns" summary
   *  (metadata.thinkingDurationMs — routing INCLUDED, same origin as the live
   *  timer). The live latch is preferred while fresh; this is the value
   *  history/reload reads after remount. */
  durationMs?: number;
  /** OUTPUT tokens generated for the finished turn (metadata.outputTokens) —
   *  the count the user cares about, not input/total. Absent while streaming —
   *  the header omits the token segment until the metadata lands at turn
   *  completion. */
  tokenCount?: number;
  /** Whether the assistant has begun streaming its answer text. Drives the
   *  live "Thinking …" header vs. the static summary. Kept separate from
   *  `isStreaming` so multi-step turns (reasoning → tool → human-input → …)
   *  don't flip the header label across the gaps between steps. */
  hasAnswerStarted?: boolean;
  /** When this turn came from Auto routing: the display name of the agent the
   *  router resolved to. Renders a routing step at the top of the timeline. */
  routedAgentName?: string;
  /** Why the router chose that agent. Paired with `routedAgentName`. */
  routeReason?: RouteReason;
  /** Live "in-flight" shell: render even with zero steps (the optimistic gap /
   *  the streaming bubble before its first part lands) instead of returning
   *  null, and show a synthetic pending row so the wait has visible forward
   *  motion. History turns leave this OFF so a finished plain answer renders no
   *  chrome (byte-identical to before). */
  optimistic?: boolean;
  /** Which pre-answer phase the optimistic shell is in — drives the synthetic
   *  pending row + the header label before any real step or route exists. */
  phase?: 'routing' | 'thinking';
  /** Root wrapper classes (the gap affordance passes its list padding here). */
  className?: string;
  /** The turn's SERVER start (`generationStartTime`, stamped at markGenerating
   *  BEFORE Auto routing). Anchors the live "Thinking · Ns" timer to ONE stable
   *  clock shared by the optimistic gap shell and the in-bubble timeline, so it
   *  neither resets at the routing→agent handoff nor across the new-chat remount,
   *  and INCLUDES the routing wait. A per-mount client clock is the fallback only
   *  for the brief window before the server value arrives. */
  turnStartMs?: number;
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
 * The post-send / resume gap affordance shown in the message list BEFORE the
 * assistant bubble exists. It is now just the optimistic `ThoughtTimeline` shell:
 * the same expandable timeline the bubble will render, mounted the instant
 * generation begins (isLoading flips true optimistically on send / human-input
 * submit). It owns the ticking "Thinking · Ns" timer, shows a synthetic pending
 * "Routing…/Thinking…" row, and surfaces the resolved "Routed to X" step as soon
 * as the live route lands — so the wait shows real forward motion and the handoff
 * to the in-bubble timeline is seamless (same component, same mount-anchored
 * timer). Kept as a named wrapper so call sites import an intention-revealing
 * name; `parts` is undefined because no message exists yet.
 */
export function ThinkingIndicator({
  className,
  phase = 'thinking',
  routedAgentName,
  routeReason,
  turnStartMs,
}: {
  className?: string;
  phase?: 'routing' | 'thinking';
  routedAgentName?: string;
  routeReason?: RouteReason;
  turnStartMs?: number;
}) {
  return (
    <ThoughtTimeline
      parts={undefined}
      isStreaming
      optimistic
      phase={phase}
      routedAgentName={routedAgentName}
      routeReason={routeReason}
      className={className}
      turnStartMs={turnStartMs}
    />
  );
}

/** A single synthetic, in-progress timeline node (spinner + muted label) shown
 *  in the optimistic shell before any real step/route exists, so the expanded
 *  timeline always has a row of forward motion during the pre-answer wait. */
function PendingPhaseRow({ label }: { label: string }) {
  return (
    <li className="relative pl-5">
      <span
        className="bg-border ring-background absolute top-1.5 left-0 size-2 rounded-full ring-2"
        aria-hidden="true"
      />
      <div className="text-muted-foreground flex items-start gap-2 text-sm">
        <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
          <Loader2 className="size-3.5 animate-spin" />
        </span>
        <span className="truncate">{label}</span>
      </div>
    </li>
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

export function ToolStepRow({
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

// Minimal markdown overrides for reasoning prose: tight, symmetric block
// spacing with the FIRST block's top margin and the LAST block's bottom margin
// zeroed (`first:mt-0 last:mb-0`), so the reasoning text's first line sits
// BESIDE the timeline dot — the base `p`'s `my-4` pushed it a line BELOW the
// dot. Color/size are inherited from the row wrapper. Deliberately tiny (just
// block spacing, no shiki / citations / router) so the timeline stays
// decoupled from the heavy chat markdown renderer.
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

function ReasoningStepRow({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
  /** Whether the OWNING message is still streaming — a reasoning block left
   *  stuck at `streaming` on an aborted turn must NOT keep animating. */
  active: boolean;
}) {
  const { t } = useT('chat');
  if (step.redacted) {
    return (
      <p className="text-muted-foreground text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }
  // Reveal reasoning with the SAME smooth typewriter the answer uses, so the
  // thought stream "out-rolls" character-by-character like the chat output
  // instead of snapping in whole. Animates only while this block is live (and
  // only one reasoning block streams at a time, before the answer — so it never
  // races the answer's typewriter for the single active-stream slot); a
  // finished or aborted block renders in full immediately. Default markdown
  // (no app component overrides) keeps the timeline decoupled from the heavy
  // chat renderer — reasoning is prose, so base markdown is enough.
  return (
    <TypewriterText
      text={step.text}
      isStreaming={active && step.state === 'streaming'}
      components={REASONING_MARKDOWN_COMPONENTS}
      className="text-muted-foreground text-sm"
    />
  );
}

export function RoutingStepRow({
  agentName,
  reason,
}: {
  agentName: string;
  reason: RouteReason;
}) {
  const { t } = useT('chat');
  return (
    <div className="flex items-start gap-2 text-sm">
      <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
        <Check className="text-success size-3.5" />
      </span>
      <span className="flex min-w-0 flex-col">
        <span className="text-foreground flex items-center gap-1.5">
          <Waypoints className="text-muted-foreground size-3.5 shrink-0" />
          <span className="truncate">
            {t('routing.routedTo', { agent: agentName })}
          </span>
        </span>
        <span className="text-muted-foreground text-xs break-words">
          {routeReasonLabel(t, reason)}
        </span>
      </span>
    </div>
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
        <ReasoningStepRow step={step} active={active} />
      ) : (
        <ToolStepRow step={step} active={active} />
      )}
    </>
  );
}

/**
 * Thinking-window timing, anchored to the turn's SERVER start (`turnStartMs` =
 * generationStartTime, stamped at markGenerating BEFORE routing). ONE stable
 * clock shared by the gap shell, the legacy timeline, and the in-bubble header,
 * so the timer neither resets at the routing→agent handoff nor across the
 * new-chat remount, and INCLUDES the routing wait. `clientFallbackRef` covers
 * only the brief pre-markGenerating window. `liveElapsedMs` ticks every second
 * while thinking; `liveDurationMs` latches the final value the instant thinking
 * ends (useLayoutEffect, so the summary paints "Thought for Ns" in one frame).
 */
function useThinkingTimer(
  turnStartMs: number | undefined,
  thinking: boolean,
): { liveElapsedMs: number | null; liveDurationMs: number | null } {
  const clientFallbackRef = useRef<number | null>(null);
  const prevThinkingRef = useRef(thinking);
  const [liveElapsedMs, setLiveElapsedMs] = useState<number | null>(null);
  const [liveDurationMs, setLiveDurationMs] = useState<number | null>(null);
  const resolveStart = useCallback(() => {
    if (typeof turnStartMs === 'number') return turnStartMs;
    if (clientFallbackRef.current === null) {
      clientFallbackRef.current = Date.now();
    }
    return clientFallbackRef.current;
  }, [turnStartMs]);
  useLayoutEffect(() => {
    if (prevThinkingRef.current && !thinking) {
      setLiveDurationMs(Date.now() - resolveStart());
    }
    prevThinkingRef.current = thinking;
  }, [thinking, resolveStart]);
  useEffect(() => {
    if (!thinking) return undefined;
    setLiveElapsedMs(Date.now() - resolveStart());
    const id = setInterval(() => {
      setLiveElapsedMs(Date.now() - resolveStart());
    }, 1000);
    return () => clearInterval(id);
  }, [thinking, resolveStart]);
  return { liveElapsedMs, liveDurationMs };
}

/**
 * A reasoning block rendered INLINE between answer chunks. Collapsed by default;
 * expansion is user-controlled and STICKY — it never auto-expands while
 * streaming nor auto-collapses when done (honors the calmer collapsed-by-default
 * rule). The brain header reveals the reasoning prose on click (typewriter while
 * live). Redacted blocks show a neutral note and aren't expandable.
 */
export function InlineReasoning({
  step,
  active,
}: {
  step: Extract<ThoughtStep, { kind: 'reasoning' }>;
  active: boolean;
}) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);

  if (step.redacted) {
    return (
      <p className="text-muted-foreground my-2 text-sm italic">
        {t('thinking.redacted')}
      </p>
    );
  }
  const streaming = active && step.state === 'streaming';
  return (
    <div className="my-2">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
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
        <span>{t('thoughtProcess.thinking')}</span>
        {streaming && <ThinkingDots />}
      </button>
      {expanded && (
        <div id={bodyId} className="border-border/60 mt-2 ml-1.5 border-l pl-3">
          <ReasoningStepRow step={step} active={active} />
        </div>
      )}
    </div>
  );
}

/** Localize the live activity verb for the header. */
function activityLabel(
  t: ReturnType<typeof useT>['t'],
  activity: ThoughtActivity,
): string {
  if (activity.type === 'routing') return t('thoughtProcess.routingPhase');
  if (activity.type === 'thinking') return t('thoughtProcess.thinking');
  if (activity.type === 'responding') return t('thoughtProcess.responding');
  // 'tool' (incl. delegate_* → "Asking {agent}").
  return formatToolDetail(t, activity.toolName, activity.input).displayText;
}

interface MessageThoughtHeaderProps {
  isStreaming: boolean;
  hasAnswerStarted: boolean;
  durationMs?: number;
  tokenCount?: number;
  toolCount: number;
  skillCount: number;
  hasReasoning: boolean;
  turnStartMs?: number;
  /** The current live activity (drives the state-based label while streaming). */
  activity?: ThoughtActivity;
  className?: string;
}

/**
 * The per-message thought header strip at the TOP of an assistant bubble. While
 * streaming it shows the live, STATE-BASED label ("Thinking…/Calling X…/
 * Routing…/Responding…") + a ticking timer; once the turn ends it latches the
 * "Thought for Ns · N tools · M tokens" summary. The reasoning/tool DETAIL now
 * renders inline in the body (see `MessageSegments`), so this header is a status
 * strip only — it no longer expands a step list.
 */
export function MessageThoughtHeader({
  isStreaming,
  hasAnswerStarted,
  durationMs,
  tokenCount,
  toolCount,
  skillCount,
  hasReasoning,
  turnStartMs,
  activity,
  className,
}: MessageThoughtHeaderProps) {
  const { t } = useT('chat');
  const active = isStreaming;
  const thinking = active && !hasAnswerStarted;
  const { liveElapsedMs, liveDurationMs } = useThinkingTimer(
    turnStartMs,
    thinking,
  );

  const toSeconds = (ms: number) => Math.max(1, Math.round(ms / 1000));

  const segments: string[] = [];
  const ms = liveDurationMs ?? durationMs ?? undefined;
  if (ms != null) {
    segments.push(
      t('thoughtProcess.durationLabel', { seconds: toSeconds(ms) }),
    );
  }
  if (toolCount > 0) {
    segments.push(t('thoughtProcess.toolsCount', { count: toolCount }));
  }
  if (skillCount > 0) {
    segments.push(t('thoughtProcess.skillsCount', { count: skillCount }));
  }
  if (tokenCount != null && tokenCount > 0) {
    segments.push(t('thoughtProcess.tokensCount', { count: tokenCount }));
  }
  const meta = segments.join(' · ');

  // Live: state-based verb. Pre-answer also carries the ticking timer; mid-answer
  // (the model paused to think / call a tool between output) shows just the verb
  // + dots so the latched "Thought for Ns" summary never visibly drops. Done:
  // the stat summary, or the honest reasoning-only fallback so it's never empty.
  let headerText: string;
  if (active) {
    const label = activityLabel(t, activity ?? { type: 'thinking' });
    headerText =
      thinking && liveElapsedMs != null
        ? `${label} · ${t('thoughtProcess.seconds', { seconds: toSeconds(liveElapsedMs) })}`
        : label;
  } else {
    headerText = meta || t('thoughtProcess.summaryReasoningOnly');
  }

  // Nothing measurable and nothing happening → render nothing (defensive; the
  // bubble already gates on showTimeline). Keeps a plain answer chrome-free.
  if (!active && !meta && !hasReasoning) return null;

  return (
    <div className={cn('mb-3', className)}>
      {/* Single fixed-height line: the live label swaps between states of
          different lengths ("Thinking" ↔ "Searching knowledge base for …"), so
          the text must TRUNCATE rather than wrap — a wrapping label changes the
          header height and shifts the whole message on every state change. */}
      <div className="text-muted-foreground flex h-5 min-w-0 items-center gap-1.5 text-sm font-medium">
        <Brain className="size-3.5 shrink-0" aria-hidden="true" />
        <span className="min-w-0 truncate text-left">{headerText}</span>
        {active && <ThinkingDots />}
      </div>
    </div>
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
  routedAgentName,
  routeReason,
  optimistic = false,
  phase = 'thinking',
  className,
  turnStartMs,
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

  // The optimistic shell shows a synthetic "Routing…" pending row ONLY while the
  // Auto router is still deciding (phase 'routing', before any real route/step
  // lands). The 'thinking' phase (pinned agent / human-input resume) needs no
  // synthetic row — the header's "Thinking · Ns" timer + dots already convey it.
  const showPendingRow =
    optimistic &&
    phase === 'routing' &&
    timeline.steps.length === 0 &&
    !routedAgentName;
  // Is there an actual row to reveal (a routing chip, real steps, or the synthetic
  // routing row)? Drives whether the chevron + toggle are shown at all.
  const hasRevealableContent =
    timeline.steps.length > 0 || !!routedAgentName || showPendingRow;

  // COLLAPSED by default; expansion is purely user-controlled and STICKY. It
  // never auto-expands while thinking nor auto-collapses when the answer starts
  // — the header ("Thinking · Ns" → "Thought for Ns") stays put and the user
  // opens the step list on demand. Auto-toggling (the old behavior) read as the
  // timeline flickering open then yanking itself shut mid-read the instant the
  // answer began; keeping it user-driven is calmer and predictable. Once the
  // user expands a turn it stays expanded through completion and into history.
  // The `message-bubble` `!isBlocked` guard still hides the whole timeline for
  // guardrails-blocked turns.
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const expanded = (userToggled ?? false) && hasRevealableContent;

  const { liveElapsedMs, liveDurationMs } = useThinkingTimer(
    turnStartMs,
    thinking,
  );

  // No reasoning or tool activity → render no chrome (plain answer) — UNLESS this
  // is the optimistic live shell (the gap / a streaming bubble before its first
  // part lands, which shows a synthetic pending row) OR there's a routing step to
  // show (an Auto-routed turn whose only "thinking" was the route decision — keep
  // the collapsed "Routed to X" chip alongside the answer instead of vanishing).
  // A plain pinned turn (no steps, no route, not optimistic) still renders
  // nothing, so finished plain answers stay byte-identical.
  if (!optimistic && timeline.steps.length === 0 && !routedAgentName) {
    return null;
  }

  // Round to the nearest second; floor at 1 so a sub-second thinking window
  // reads as "1s" rather than "0s".
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
    // Prefer the live latch (captured at answer-start from the SERVER turn
    // start) over the persisted `durationMs` prop (metadata.thinkingDurationMs).
    // Both are anchored to the SAME origin — markGenerating, routing INCLUDED —
    // so they agree; the latch just lands a beat sooner than the metadata, with
    // no "15s → 3s" drop. History (remounted, no live latch) falls back to the
    // persisted value.
    const ms = liveDurationMs ?? durationMs ?? undefined;
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
  // After the turn, lead the collapsed header with which agent the Auto router
  // picked — visible without expanding — so the routing decision is never
  // hidden. Only available post-turn (metadata lands at completion), so it
  // never competes with the live "Thinking…" header.
  const routedPrefix =
    !thinking && routeReason && routedAgentName
      ? t('routing.routedTo', { agent: routedAgentName })
      : undefined;
  // While thinking, the header is the generic "Thinking · Ns" overall-status
  // timer; the specific phase ("Routing…" / the routed-to chip / tool steps) is
  // carried by the rows below, so the header never echoes a row. After the turn,
  // lead with the routed agent (when Auto-routed), then the stats; if nothing is
  // measurable fall back to the honest reasoning-only label so it's never empty.
  const headerText = thinking
    ? meta
      ? `${t('thoughtProcess.thinking')} · ${meta}`
      : t('thoughtProcess.thinking')
    : routedPrefix
      ? meta
        ? `${routedPrefix} · ${meta}`
        : routedPrefix
      : meta || t('thoughtProcess.summaryReasoningOnly');

  const stepList = (
    <ul
      id={stepsId}
      className="border-border/60 mt-2 ml-1.5 flex flex-col gap-2 border-l pl-2"
    >
      {routeReason && routedAgentName && (
        <li className="relative pl-5">
          <span
            className="bg-border ring-background absolute top-1.5 left-0 size-2 rounded-full ring-2"
            aria-hidden="true"
          />
          <RoutingStepRow agentName={routedAgentName} reason={routeReason} />
        </li>
      )}
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
      {showPendingRow && (
        <PendingPhaseRow label={t('thoughtProcess.routingPhase')} />
      )}
    </ul>
  );

  return (
    <div className={cn('mb-3', className)}>
      {/* One collapsible header for every state (thinking / answering /
          finished): a chevron + brain + the live-or-final stat row. Collapsed
          by default; the user expands to reveal the step list. While thinking
          the bouncing dots signal live activity next to the ticking timer. */}
      <button
        type="button"
        // Only a toggle when there's something to reveal. The live pre-step
        // "Thinking…" shell has no rows yet, so it stays a plain (non-toggling)
        // header until the first step/route lands.
        onClick={
          hasRevealableContent ? () => setUserToggled(!expanded) : undefined
        }
        aria-expanded={hasRevealableContent ? expanded : undefined}
        // The <ul id={stepsId}> is only mounted while `expanded` ({expanded &&
        // stepList}); point aria-controls at it only when it exists so we don't
        // leave a dangling reference (flagged by axe aria-valid-attr-value).
        aria-controls={hasRevealableContent && expanded ? stepsId : undefined}
        className={cn(
          'flex items-center gap-1.5 text-sm font-medium',
          hasRevealableContent
            ? 'text-muted-foreground hover:text-foreground cursor-pointer transition-colors'
            : 'text-muted-foreground cursor-default',
        )}
      >
        <ChevronRight
          className={cn(
            'size-3.5 shrink-0 transition-transform',
            expanded && 'rotate-90',
            // Nothing to expand yet → hide the chevron but keep its box so the
            // header doesn't shift sideways when the first row appears.
            !hasRevealableContent && 'invisible',
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
