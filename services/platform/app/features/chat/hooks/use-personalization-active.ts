import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';

/**
 * Reactive flag: is personalization active for this thread? Mirrors the
 * server-side `evaluatePersonalizationGates` exactly (org feature flag,
 * `prefs.enabled === true`, `!threadDisablePersonalization`). The chat
 * UI uses this to decide whether to render the inline pending-memory
 * section, keeping read/write/UI behavior in lockstep.
 */
export function usePersonalizationActiveForThread(
  threadId: string | undefined,
): boolean {
  const result = useQuery(
    api.personalization.queries.isPersonalizationActiveForChat,
    threadId ? { threadId } : 'skip',
  );
  return result === true;
}
