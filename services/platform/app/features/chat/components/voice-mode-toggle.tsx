'use client';

import { Button } from '@tale/ui/button';
import { useMutation, useQuery } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Volume2, VolumeOff } from 'lucide-react';
import { useCallback } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useSetVoiceOutput } from '@/app/features/settings/personalization/hooks/mutations';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useVoiceCapabilities } from '../hooks/use-voice-capabilities';
import { useVoiceModeEffective } from '../hooks/use-voice-output';
import { useVoiceAudioElement } from '../hooks/voice-output-context';
import { primeAudio } from '../utils/prime-audio';

interface VoiceModeToggleProps {
  threadId: string | undefined;
  /** Owning org — used to detect whether a text-to-speech model is configured. */
  organizationId: string;
  disabled?: boolean;
}

/**
 * Composer voice-mode toggle — reads replies aloud for the current thread.
 * Sits next to the dictation button in the composer (relocated from the
 * chat-header dropdown so the speak/listen controls live together).
 *
 * Once a thread exists it writes a per-thread override via
 * `setThreadVoiceOutputOverride` that wins over the user's master switch in
 * either direction. On a brand-new chat (no thread yet) it instead toggles the
 * user-level default (`setUserVoiceOutput`) so "read replies out loud" is
 * available before the first message and carries into the new thread. On enable
 * it banks the iOS user-gesture token through `primeAudio` so the first
 * synthesized chunk can autoplay.
 */
export function VoiceModeToggle({
  threadId,
  organizationId,
  disabled,
}: VoiceModeToggleProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const voiceMode = useVoiceModeEffective(threadId);
  const setOverride = useMutation(
    api.tts.mutations.setThreadVoiceOutputOverride,
  );
  // New-chat path: there's no thread to override yet, so reflect + write the
  // user-level default instead.
  const myPrefs = useQuery(
    api.user_preferences.queries.getMyPreferences,
    threadId ? 'skip' : { organizationId },
  );
  const { mutateAsync: setUserVoiceOutput } = useSetVoiceOutput();
  // `null` outside the VoiceOutputProvider (the composer is) — primeAudio
  // then banks only the AudioContext, which is all we can do here.
  const audioElement = useVoiceAudioElement();

  // Reading replies aloud needs a configured text-to-speech model. When none
  // exists, disable the toggle and explain why on hover instead of letting the
  // user enable a mode that fails silently at synthesis time. Treat it as
  // available while the provider list loads so we don't flash a disabled state.
  const { hasTts, isLoading: capsLoading } =
    useVoiceCapabilities(organizationId);
  const ttsUnavailable = !capsLoading && !hasTts;

  const enabled = threadId ? voiceMode.enabled : Boolean(myPrefs?.voiceOutput);

  const handleToggle = useCallback(() => {
    if (ttsUnavailable) return;
    const next = !enabled;
    // Bank the user-gesture token synchronously on enable so iOS Safari's
    // autoplay gate accepts the first chunk after the mutation round-trip.
    if (next) primeAudio(audioElement);
    void (async () => {
      try {
        if (threadId) {
          await setOverride({ threadId, override: next });
        } else {
          await setUserVoiceOutput({ organizationId, enabled: next });
        }
      } catch (err) {
        console.error('[voice] composer toggle failed', err);
        const serverMessage =
          err instanceof ConvexError && isRecord(err.data)
            ? err.data.message
            : undefined;
        toast({
          title:
            typeof serverMessage === 'string'
              ? serverMessage
              : t('voice.voiceOutputThreadSaveFailed'),
          variant: 'destructive',
        });
      }
    })();
  }, [
    threadId,
    organizationId,
    ttsUnavailable,
    enabled,
    audioElement,
    setOverride,
    setUserVoiceOutput,
    toast,
    t,
  ]);

  // An org-level governance veto (`org_policy`) can only be detected once a
  // thread exists — hide the control then. On a new chat we still show it (the
  // new thread inherits any veto once created).
  if (threadId && voiceMode.source === 'org_policy') return null;

  return (
    <Tooltip
      content={
        ttsUnavailable
          ? t('voice.voiceOutputErrorConfig')
          : enabled
            ? t('voice.voiceModeDisable')
            : t('voice.voiceModeEnable')
      }
      side="top"
    >
      <Button
        type="button"
        variant={enabled ? 'secondary' : 'ghost'}
        size="icon"
        onClick={handleToggle}
        disabled={disabled}
        // `aria-disabled` (not native `disabled`) for the not-configured case
        // so the button stays hoverable/focusable and the explanatory Tooltip
        // can still fire; `handleToggle` already no-ops while unavailable.
        aria-disabled={ttsUnavailable || undefined}
        aria-pressed={enabled}
        aria-label={t('voice.voiceModeLabel')}
        className={cn(
          'rounded-full',
          enabled && 'bg-primary/10 text-primary hover:bg-primary/15',
          ttsUnavailable && 'cursor-not-allowed opacity-50',
        )}
      >
        {enabled ? (
          <Volume2 className="size-4" />
        ) : (
          <VolumeOff className="size-4" />
        )}
      </Button>
    </Tooltip>
  );
}
