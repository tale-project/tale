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
 * The "inheriting" state shows the icon at reduced opacity; explicit
 * overrides are full-opacity so the user can tell at a glance whether
 * this thread differs from their default.
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
  const tooltip = overriding
    ? effective.enabled
      ? t('voice.voiceOutputOn')
      : t('voice.voiceOutputOff')
    : t('voice.voiceOutputInheritGlobal');

  return (
    <Tooltip content={tooltip} side="bottom">
      <Button
        size="icon"
        variant="ghost"
        onClick={onClick}
        aria-label={tooltip}
        aria-pressed={effective.enabled}
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
