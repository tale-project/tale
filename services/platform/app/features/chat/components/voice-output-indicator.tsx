'use client';

import { Button } from '@tale/ui/button';
import { CircleStop, Volume2 } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useVoiceOutputPlayer } from '../hooks/use-voice-output-player';

interface VoiceOutputIndicatorProps {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  organizationId: string | undefined;
  text: string;
  isStreaming: boolean;
}

/**
 * Play / stop button for an assistant message's voice output. The
 * chunker hook lives on the parent message bubble (so it can run during
 * streaming when this indicator isn't yet mounted); the indicator owns
 * just the player and the visible control.
 */
export function VoiceOutputIndicator(props: VoiceOutputIndicatorProps) {
  const { t } = useT('chat');
  const player = useVoiceOutputPlayer({
    enabled: props.enabled,
    messageId: props.messageId,
    threadId: props.threadId,
  });

  if (!props.enabled) return null;
  if (!player.hasAudio && !props.isStreaming) return null;

  const speaking = player.state === 'playing';
  const label = speaking
    ? t('voice.voiceOutputSpeaking')
    : t('voice.voiceOutputStopped');
  return (
    <Tooltip content={label} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        className="p-1"
        aria-label={label}
        onClick={speaking ? player.stop : player.play}
      >
        {speaking ? (
          <CircleStop className="text-primary size-4 animate-pulse" />
        ) : (
          <Volume2
            className={cn(
              'size-4',
              player.state === 'error' && 'text-destructive',
            )}
          />
        )}
      </Button>
    </Tooltip>
  );
}
