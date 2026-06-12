'use client';

import { useT } from '@/lib/i18n/client';

import type { ThoughtActivity } from '../../utils/build-message-segments';
import { activityLabel } from './activity-label';
import { ThoughtHeader } from './thought-header';
import { useStalledSilence } from './use-stalled-silence';
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
  /** When the turn's agent last emitted a stream event. A gap past
   *  WORKING_STALL_MS swaps a bare "Thinking" label for "Still working" —
   *  the turn is alive but silent (e.g. an in-session background task). */
  lastEventAt?: number;
  className?: string;
}

/**
 * The per-message thought header strip at the TOP of an assistant bubble. While
 * streaming it shows the live, STATE-BASED label ("Thinking…/Calling X…/
 * Routing…/Responding…") + a ticking timer; once the turn ends it latches the
 * "Thought for Ns · N tools · M tokens" summary. The reasoning/tool DETAIL
 * renders inline in the body (see `MessageSegments`), so this header is a status
 * strip only — it never expands a step list.
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
  lastEventAt,
  className,
}: MessageThoughtHeaderProps) {
  const { t } = useT('chat');
  const active = isStreaming;
  const thinking = active && !hasAnswerStarted;
  const { liveElapsedMs, liveDurationMs } = useThinkingTimer(
    turnStartMs,
    thinking,
  );
  // Hook owns its own coarse tick: once the answer has started the 1s thinking
  // timer is off and a silent stretch streams nothing, so without it the stall
  // flip would never re-render this header.
  const stalled = useStalledSilence(lastEventAt, active);

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
    // Honest-silence override: only the bare "Thinking" fallback is replaced —
    // a live tool/responding label is more specific and stays.
    let live = activity ?? { type: 'thinking' as const };
    if (stalled && live.type === 'thinking') {
      live = { type: 'working' as const };
    }
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

  return (
    <ThoughtHeader text={headerText} showDots={active} className={className} />
  );
}
