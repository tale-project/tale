'use client';

import { useId, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { ThoughtActivity } from '../../utils/build-message-segments';
import type { ThoughtStep } from '../../utils/thought-step-types';
import { activityLabel } from './activity-label';
import { ReasoningStepRow, STEP_INDENT } from './step-rows';
import { ThoughtHeader } from './thought-header';
import { toSeconds, useThinkingTimer } from './use-thinking-timer';

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
  /** The turn's reasoning blocks, in chronological order. When present this
   *  header becomes the SINGLE thinking control: a chevron reveals all of them
   *  below (collapsed by default), so they're no longer rendered inline among
   *  the answer/tool rows. */
  reasoningSteps?: Array<Extract<ThoughtStep, { kind: 'reasoning' }>>;
  className?: string;
}

/**
 * The per-message thought header strip at the TOP of an assistant bubble. While
 * streaming it shows the live, STATE-BASED label ("Thinking…/Calling X…/
 * Routing…/Responding…") + a ticking timer; once the turn ends it latches the
 * "Thought for Ns · N tools · M tokens" summary.
 *
 * This header is also the SINGLE reasoning control: when `reasoningSteps` are
 * present a chevron reveals all of them below (collapsed by default, sticky —
 * never auto-expands/collapses). Reasoning is therefore NOT rendered inline
 * among the answer/tool rows; only the high-information action rows (tools,
 * routing) stay inline (see `MessageSegments`). Tool DETAIL still renders
 * inline.
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
  reasoningSteps,
  className,
}: MessageThoughtHeaderProps) {
  const { t } = useT('chat');
  const bodyId = useId();
  const [expanded, setExpanded] = useState(false);
  const active = isStreaming;
  const thinking = active && !hasAnswerStarted;
  const { liveElapsedMs, liveDurationMs } = useThinkingTimer(
    turnStartMs,
    thinking,
  );

  // Build the "·"-separated summary shown once the turn ends. Each segment is
  // included only when its value is known.
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
  // so the latched "Thought for Ns" summary never visibly drops. Done: the stat
  // summary, or the honest reasoning-only fallback so it's never empty.
  let headerText: string;
  if (active) {
    const live = activity ?? { type: 'thinking' as const };
    const label = activityLabel(t, live);
    headerText =
      thinking && liveElapsedMs != null
        ? `${label} · ${t('thoughtProcess.seconds', { seconds: toSeconds(liveElapsedMs) })}`
        : label;
  } else {
    headerText = meta || t('thoughtProcess.summaryReasoningOnly');
  }

  // Nothing measurable and nothing happening → render nothing (defensive; the
  // bubble already gates on hasActualThought). Keeps a plain answer chrome-free.
  if (!active && !meta && !hasReasoning) return null;

  // Expandable when the header owns reasoning to reveal. The chevron sits in a
  // reserved-width slot (see ThoughtHeader) so it can appear mid-stream without
  // shifting the label. Safety valve: if a gap→bubble jitter ever shows up,
  // gate this with `&& !active` so the chevron only appears once the turn ends.
  const expandable = (reasoningSteps?.length ?? 0) > 0;

  return (
    <>
      <ThoughtHeader
        text={headerText}
        showDots={active}
        className={className}
        expandable={expandable}
        expanded={expanded}
        onToggle={() => setExpanded((v) => !v)}
        bodyId={bodyId}
      />
      {expandable && expanded && reasoningSteps && (
        // The header's own `mb-3` provides the gap above; this body adds only the
        // bottom margin that separates the reasoning from the answer below.
        <div id={bodyId} className={cn('mb-3 space-y-2', STEP_INDENT)}>
          {reasoningSteps.map((step) =>
            step.redacted ? (
              <p key={step.id} className="text-muted-foreground text-sm italic">
                {t('thinking.redacted')}
              </p>
            ) : (
              <ReasoningStepRow key={step.id} step={step} active={active} />
            ),
          )}
        </div>
      )}
    </>
  );
}
