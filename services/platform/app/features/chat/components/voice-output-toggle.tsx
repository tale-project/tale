'use client';

import { Button } from '@tale/ui/button';
import { useMutation } from 'convex/react';
import { Volume2, VolumeX } from 'lucide-react';
import { useCallback } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useVoiceModeEffective } from '../hooks/use-voice-output';
import { primeAudio } from '../utils/prime-audio';

interface VoiceOutputToggleProps {
  threadId: string;
  className?: string;
}

/**
 * Tri-state voice-mode toggle for the chat header. Click cycles:
 *   inheriting-default → explicit override (true)
 *                     → explicit override (false)
 *                     → clear override (back to inheriting)
 *
 * Side effect on enable: primes a hidden `<audio>` element by calling
 * `play()/pause()` on a silent buffer so the user-gesture token persists
 * across the async window before the first synthesised chunk arrives.
 * Without this, iOS Safari and stricter Chromium builds reject the first
 * autoplay attempt and the indicator stalls in `'blocked'`.
 */
export function VoiceOutputToggle({
  threadId,
  className,
}: VoiceOutputToggleProps) {
  const effective = useVoiceModeEffective(threadId);
  const setOverride = useMutation(
    api.tts.mutations.setThreadVoiceOutputOverride,
  );
  const { t } = useT('chat');

  const onClick = useCallback(() => {
    const willEnable =
      effective.source !== 'thread'
        ? !effective.enabled
        : effective.enabled
          ? false
          : null;
    // Only prime when we're about to flip voice ON for this thread.
    if (willEnable === true) void primeAudio();
    if (effective.source !== 'thread') {
      void setOverride({ threadId, override: !effective.enabled });
      return;
    }
    if (effective.enabled) {
      void setOverride({ threadId, override: false });
      return;
    }
    void setOverride({ threadId, override: null });
  }, [effective, setOverride, threadId]);

  const overriding = effective.source === 'thread';
  // Action-oriented label (M1): tells screen-reader users what activation
  // will do, not just the current state.
  const tooltip = overriding
    ? effective.enabled
      ? t('voice.voiceOutputOn')
      : t('voice.voiceOutputOff')
    : t('voice.voiceOutputInheritGlobal');
  // aria-pressed: use `"mixed"` for the inheriting tri-state per ARIA APG
  // so SR users can distinguish "explicit off" from "inheriting (off)".
  const ariaPressed: boolean | 'mixed' = overriding
    ? effective.enabled
    : 'mixed';

  return (
    <Tooltip content={tooltip} side="bottom">
      <Button
        size="icon"
        variant="ghost"
        onClick={onClick}
        aria-label={tooltip}
        aria-pressed={ariaPressed}
        className={cn(!overriding && 'opacity-60', className)}
      >
        {effective.enabled ? (
          <Volume2 className="size-5" />
        ) : (
          <VolumeX className="size-5" />
        )}
      </Button>
    </Tooltip>
  );
}
