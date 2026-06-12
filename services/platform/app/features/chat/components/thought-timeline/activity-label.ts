import type { useT } from '@/lib/i18n/client';

import type { ThoughtActivity } from '../../utils/build-message-segments';
import { formatToolDetail } from '../../utils/format-tool-detail';

/** How long the turn may stay silent (no stream events) before the live
 * "Thinking" header switches to the honest "Still working" label. */
export const WORKING_STALL_MS = 60_000;

/**
 * Localize a streaming turn's live activity into the header verb
 * ("Routing…" / "Thinking…" / "Responding…" / "Searching knowledge base for …").
 * Shared by the in-bubble header and the gap-shell indicator so both speak with
 * one voice. Pure — takes the `chat` translator directly.
 */
export function activityLabel(
  t: ReturnType<typeof useT>['t'],
  activity: ThoughtActivity,
): string {
  if (activity.type === 'routing') return t('thoughtProcess.routingPhase');
  if (activity.type === 'thinking') return t('thoughtProcess.thinking');
  if (activity.type === 'responding') return t('thoughtProcess.responding');
  if (activity.type === 'working') return t('thoughtProcess.working');
  // 'tool' (incl. delegate_* → "Asking {agent}").
  return formatToolDetail(t, activity.toolName, activity.input).displayText;
}
