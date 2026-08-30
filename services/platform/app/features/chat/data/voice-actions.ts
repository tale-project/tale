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

import { useCallback, useMemo } from 'react';

import { toast } from '@/app/hooks/use-toast';
import {
  invalidateVoiceMode,
  setThreadVoiceOverrideRequest,
  setUserVoiceOutputRequest,
} from '@/app/lib/backend/chat';
import { useT } from '@/lib/i18n/client';
import { AppError } from '@/lib/shared/errors/app-error';
import { isRecord } from '@/lib/utils/type-utils';

import { useChatQueryClient } from './chat-backend';

/** Prefer the server's own explanation (a AppError payload message, e.g.
 * the governance-veto wording) over the generic fallback. */
function voiceSaveFailedToast(error: unknown, fallbackTitle: string) {
  const serverMessage =
    error instanceof AppError && isRecord(error.data)
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
  const queryClient = useChatQueryClient();
  const { t } = useT('chat');

  const setThreadOverride = useCallback(
    (threadId: string, override: boolean | null): void => {
      setThreadVoiceOverrideRequest(organizationId, threadId, override)
        .then(() => invalidateVoiceMode(queryClient, organizationId))
        .catch((error: unknown) => {
          console.warn('[voice] saving the thread override failed', error);
          voiceSaveFailedToast(error, t('voice.voiceOutputThreadSaveFailed'));
        });
    },
    [queryClient, organizationId, t],
  );

  const setUserDefault = useCallback(
    (enabled: boolean): void => {
      setUserVoiceOutputRequest(organizationId, enabled)
        .then(() => invalidateVoiceMode(queryClient, organizationId))
        .catch((error: unknown) => {
          console.warn('[voice] saving the voice default failed', error);
          voiceSaveFailedToast(error, t('voice.voiceOutputThreadSaveFailed'));
        });
    },
    [queryClient, organizationId, t],
  );

  return useMemo(
    () => ({
      available: true,
      setThreadOverride,
      setUserDefault,
    }),
    [setThreadOverride, setUserDefault],
  );
}
