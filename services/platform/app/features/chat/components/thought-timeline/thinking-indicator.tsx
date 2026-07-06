'use client';

import { useT } from '@/lib/i18n/client';

import type { ThoughtActivity } from '../../utils/build-message-segments';
import type { RouteReason } from '../../utils/route-reason';
import { activityLabel } from './activity-label';
import { RoutingStepRow } from './step-rows';
import { ThoughtHeader } from './thought-header';
import {
  toSeconds,
  useThinkingTimer,
  type ThinkingAnchor,
} from './use-thinking-timer';

/**
 * The post-send / resume gap affordance shown in the message list BEFORE the
 * assistant bubble exists. It renders the SAME `ThoughtHeader` strip the bubble
 * will render — same brain, same position, same ticking timer (anchored to the
 * shared `anchor`, so the clock continues seamlessly across the
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
  queued = false,
  routedAgentName,
  routeReason,
  anchor,
}: {
  className?: string;
  /** 'routing' while the Auto router is still deciding (no agent yet); 'thinking'
   *  for a pinned agent, a human-input resume, or once the route has resolved. */
  phase?: 'routing' | 'thinking';
  /** Park-on-capacity: the turn is waiting for a free sandbox slot (org at its
   *  concurrency cap). Overrides the label to "Queued for capacity" while the
   *  timer keeps ticking, so the user sees a deliberate wait, not a stall. */
  queued?: boolean;
  routedAgentName?: string;
  routeReason?: RouteReason;
  anchor?: ThinkingAnchor;
}) {
  const { t } = useT('chat');
  // The gap is always a pre-answer "thinking" window, so the timer ticks.
  const { liveElapsedMs } = useThinkingTimer(anchor, true);

  // "Routing · Ns" while the router decides; "Thinking · Ns" once it has (or for
  // a pinned agent). Once resolved, chat-interface passes phase 'thinking' with
  // the routed agent, so the header reads "Thinking" and the chip carries the
  // routing decision — matching the in-bubble split. A queued turn overrides the
  // label (still a thinking-phase window, so the timer continues).
  const activity: ThoughtActivity =
    phase === 'routing' && !routedAgentName
      ? { type: 'routing' }
      : { type: 'thinking' };
  const label = queued
    ? t('thoughtProcess.queuedForCapacity')
    : activityLabel(t, activity);
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
