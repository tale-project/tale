'use client';

/**
 * The voice-mode writes: the per-thread "Read replies aloud" override and
 * the user default the index checkbox falls back to. Fire-and-forget like
 * the model preference — a lost write costs one re-toggle, never a blocked
 * send — and provider-less renders degrade to `available: false`.
 */

import { useConvex } from 'convex/react';
import { useCallback, useMemo } from 'react';

import { api } from '@/convex/_generated/api';

export interface VoiceActions {
  readonly available: boolean;
  /** Set (or with `null`, clear) the conversation's override. */
  readonly setThreadOverride: (
    threadId: string,
    override: boolean | null,
  ) => void;
  /** The user's default, used when no conversation is open yet. */
  readonly setUserDefault: (enabled: boolean) => void;
}

export function useVoiceActions(organizationId: string): VoiceActions {
  const convex = useConvex();

  const setThreadOverride = useCallback(
    (threadId: string, override: boolean | null): void => {
      if (!convex) return;
      convex
        .mutation(api.tts.mutations.setThreadVoiceOutputOverride, {
          organizationId,
          threadId,
          override,
        })
        .catch((error: unknown) => {
          console.warn('[voice] saving the thread override failed', error);
        });
    },
    [convex, organizationId],
  );

  const setUserDefault = useCallback(
    (enabled: boolean): void => {
      if (!convex) return;
      convex
        .mutation(api.tts.mutations.setUserVoiceOutput, {
          organizationId,
          enabled,
        })
        .catch((error: unknown) => {
          console.warn('[voice] saving the voice default failed', error);
        });
    },
    [convex, organizationId],
  );

  return useMemo(
    () => ({
      available: convex !== undefined,
      setThreadOverride,
      setUserDefault,
    }),
    [convex, setThreadOverride, setUserDefault],
  );
}
