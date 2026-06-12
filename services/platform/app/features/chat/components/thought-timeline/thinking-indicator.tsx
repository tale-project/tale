'use client';

import { useT } from '@/lib/i18n/client';

import type { ThoughtActivity } from '../../utils/build-message-segments';
import type { RouteReason } from '../../utils/route-reason';
import { activityLabel } from './activity-label';
import { RoutingStepRow } from './step-rows';
import { ThoughtHeader } from './thought-header';
import { useStalledSilence } from './use-stalled-silence';
import { toSeconds, useThinkingTimer } from './use-thinking-timer';

/**
 * The post-send / resume gap affordance shown in the message list BEFORE the
 * assistant bubble exists. It renders the SAME `ThoughtHeader` strip the bubble
 * will render — same brain, same position, same ticking timer (anchored to the
 * shared server `turnStartMs`, so the clock continues seamlessly across the
 * handoff) — plus the inline "Routed to X" chip once Auto routing resolves,
 * exactly as the bubble shows it via `MessageSegments`. Because the markup and
 * the timer are identical on both sides, the handoff has zero horizontal/
 * vertical jump (the old chevron-led timeline shifted the title left when the
 * bubble took over).
 *
 * `parts` is undefined here because no message exists yet; the live label is
 * derived purely from the routing/thinking phase.
 */
export function ThinkingIndicator({
  className,
  phase = 'thinking',
  routedAgentName,
  routeReason,
  turnStartMs,
  lastEventAt,
}: {
  className?: string;
  /** 'routing' while the Auto router is still deciding (no agent yet); 'thinking'
   *  for a pinned agent, a human-input resume, or once the route has resolved. */
  phase?: 'routing' | 'thinking';
  routedAgentName?: string;
  routeReason?: RouteReason;
  turnStartMs?: number;
  /** When the turn's agent last emitted a stream event. A gap past
   *  WORKING_STALL_MS swaps the "Thinking" label for "Still working" — the
   *  turn is alive but silent (e.g. an in-session background task). */
  lastEventAt?: number;
}) {
  const { t } = useT('chat');
  // The gap is always a pre-answer "thinking" window, so the timer ticks.
  const { liveElapsedMs } = useThinkingTimer(turnStartMs, true);
  const stalled = useStalledSilence(lastEventAt, true);

  // "Routing · Ns" while the router decides; "Thinking · Ns" once it has (or for
  // a pinned agent). Once resolved, chat-interface passes phase 'thinking' with
  // the routed agent, so the header reads "Thinking" and the chip carries the
  // routing decision — matching the in-bubble split.
  let activity: ThoughtActivity =
    phase === 'routing' && !routedAgentName
      ? { type: 'routing' }
      : { type: 'thinking' };
  // Honest-silence override: the turn is alive but the agent has been quiet
  // past the threshold — say so instead of ticking "Thinking" forever.
  if (stalled && activity.type === 'thinking') {
    activity = { type: 'working' };
  }
  const label = activityLabel(t, activity);
  const headerText =
    liveElapsedMs != null
      ? `${label} · ${t('thoughtProcess.seconds', { seconds: toSeconds(liveElapsedMs) })}`
      : label;

  const showRouting = !!routedAgentName && !!routeReason;

  return (
    <div className={className}>
      <ThoughtHeader text={headerText} showDots />
      {showRouting && (
        <RoutingStepRow agentName={routedAgentName} reason={routeReason} />
      )}
    </div>
  );
}
