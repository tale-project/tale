'use client';

/**
 * The voice-mode writes: the per-thread "Read replies aloud" override and
 * the user default the index toggle falls back to. Fire-and-forget like
 * the model preference — a lost write costs one re-toggle, never a blocked
 * send — and provider-less renders degrade to `available: false`.
 *
 * Failures DO surface: the toggle reflects the reactive query, so a refused
 * write visibly bounces back — without a toast naming the cause (most often
 * a governance veto) that reads as "the switch is broken".
 */

import { useConvex } from 'convex/react';
import { ConvexError } from 'convex/values';
import { useCallback, useMemo } from 'react';

import { toast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { isRecord } from '@/lib/utils/type-utils';

/** Prefer the server's own explanation (a ConvexError payload message, e.g.
 * the governance-veto wording) over the generic fallback. */
function voiceSaveFailedToast(error: unknown, fallbackTitle: string) {
  const serverMessage =
    error instanceof ConvexError && isRecord(error.data)
      ? error.data.message
      : undefined;
  toast({
    title: typeof serverMessage === 'string' ? serverMessage : fallbackTitle,
    variant: 'destructive',
  });
}

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
  const { t } = useT('chat');

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
          voiceSaveFailedToast(error, t('voice.voiceOutputThreadSaveFailed'));
        });
    },
    [convex, organizationId, t],
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
          voiceSaveFailedToast(error, t('voice.voiceOutputThreadSaveFailed'));
        });
    },
    [convex, organizationId, t],
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
