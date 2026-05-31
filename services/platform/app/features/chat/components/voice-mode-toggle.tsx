'use client';

import { Button } from '@tale/ui/button';
import { useMutation } from 'convex/react';
import { ConvexError } from 'convex/values';
import { Volume2, VolumeOff } from 'lucide-react';
import { useCallback } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { isRecord } from '@/lib/utils/type-guards';

import { useVoiceModeEffective } from '../hooks/use-voice-output';
import { useVoiceAudioElement } from '../hooks/voice-output-context';
import { primeAudio } from '../utils/prime-audio';

interface VoiceModeToggleProps {
  threadId: string | undefined;
  disabled?: boolean;
}

/**
 * Composer voice-mode toggle — reads replies aloud for the current thread.
 * Sits next to the dictation button in the composer (relocated from the
 * chat-header dropdown so the speak/listen controls live together).
 *
 * Writes a per-thread override via `setThreadVoiceOutputOverride` that wins
 * over the user's master switch in either direction, mirroring the old
 * header checkbox. On enable it banks the iOS user-gesture token through
 * `primeAudio` so the first synthesized chunk can autoplay.
 */
export function VoiceModeToggle({ threadId, disabled }: VoiceModeToggleProps) {
  const { t } = useT('chat');
  const { toast } = useToast();
  const voiceMode = useVoiceModeEffective(threadId);
  const setOverride = useMutation(
    api.tts.mutations.setThreadVoiceOutputOverride,
  );
  // `null` outside the VoiceOutputProvider (the composer is) — primeAudio
  // then banks only the AudioContext, which is all we can do here.
  const audioElement = useVoiceAudioElement();

  const enabled = voiceMode.enabled;

  const handleToggle = useCallback(() => {
    if (!threadId) return;
    const next = !enabled;
    // Bank the user-gesture token synchronously on enable so iOS Safari's
    // autoplay gate accepts the first chunk after the mutation round-trip.
    if (next) primeAudio(audioElement);
    void (async () => {
      try {
        await setOverride({ threadId, override: next });
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
  }, [threadId, enabled, audioElement, setOverride, toast, t]);

  // No per-thread target yet (fresh chat), or an org-level governance veto
  // (`org_policy`) that no user override can lift → hide rather than show a
  // misleading control.
  if (!threadId || voiceMode.source === 'org_policy') return null;

  return (
    <Tooltip
      content={
        enabled ? t('voice.voiceModeDisable') : t('voice.voiceModeEnable')
      }
      side="top"
    >
      <Button
        type="button"
        variant={enabled ? 'secondary' : 'ghost'}
        size="icon"
        onClick={handleToggle}
        disabled={disabled}
        aria-pressed={enabled}
        aria-label={t('voice.voiceModeLabel')}
        className={cn(
          'rounded-full',
          enabled && 'bg-primary/10 text-primary hover:bg-primary/15',
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
