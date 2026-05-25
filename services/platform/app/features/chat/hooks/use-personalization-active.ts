import { useQuery } from 'convex/react';

import { api } from '@/convex/_generated/api';

interface PersonalizationActive {
  customInstructions: boolean;
  memories: boolean;
}

const INACTIVE: PersonalizationActive = {
  customInstructions: false,
  memories: false,
};

/**
 * Reactive flags: which personalization features are active for this
 * thread? Mirrors the server-side `evaluatePersonalizationGates` exactly
 * (org default, tri-state user override, thread-level veto) for both
 * Custom Instructions and User Memories independently. The chat UI uses
 * the `memories` flag to decide whether to subscribe to pending memory
 * proposals at all, keeping read/write/UI behavior in lockstep.
 */
export function usePersonalizationActiveForThread(
  threadId: string | undefined,
  organizationId: string,
): PersonalizationActive {
  const result = useQuery(
    api.personalization.queries.isPersonalizationActiveForChat,
    threadId ? { threadId, organizationId } : 'skip',
  );
  return result ?? INACTIVE;
}
