'use client';

import { Button } from '@tale/ui/button';
import { AlertCircle, CircleStop, Loader2, Volume2 } from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useVoiceOutputPlayer } from '../hooks/use-voice-output-player';

interface VoiceOutputIndicatorProps {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  isStreaming: boolean;
}

/**
 * Play / stop button for an assistant message's voice output. The chunker
 * hook lives on the parent message bubble (so it can run during streaming
 * when this indicator isn't yet mounted); the indicator owns just the
 * player and the visible control.
 *
 * Visual states (review M1/M2/M3/M9/M15/H6a):
 *  - `'playing'`  → animated stop icon (motion-safe; static if reduced motion)
 *  - `'idle'` w/ chunks → "Play" button
 *  - `'idle'` no chunks but streaming/pending → loading spinner
 *  - `'blocked'` → "Tap to play" — autoplay was rejected
 *  - `'error'`   → alert icon + classified error tooltip
 *
 * Each state announces itself via an `aria-live="polite"` region so SR
 * users get parity with the visual cue.
 */
export function VoiceOutputIndicator(props: VoiceOutputIndicatorProps) {
  const { t } = useT('chat');
  const prefersReducedMotion = usePrefersReducedMotion();
  const player = useVoiceOutputPlayer({
    enabled: props.enabled,
    messageId: props.messageId,
    threadId: props.threadId,
    isStreaming: props.isStreaming,
  });

  if (!props.enabled) return null;
  // Show a buffering indicator while the assistant is still streaming and
  // no chunk has reached a playable state yet — otherwise the user sees a
  // long silent gap with no UI signal that work is in progress.
  const showLoading = !player.hasAudio && props.isStreaming;
  if (!player.hasAudio && !props.isStreaming) return null;

  const speaking = player.state === 'playing';
  const blocked = player.state === 'blocked';
  const errored = player.state === 'error' || player.errorCode !== undefined;

  let label: string;
  let actionLabel: string;
  let icon: React.ReactNode;
  let onClick: () => void = player.play;

  if (showLoading) {
    label = t('voice.voiceOutputLoading');
    actionLabel = label;
    icon = (
      <Loader2
        className={cn(
          'size-4 text-muted-foreground',
          !prefersReducedMotion && 'animate-spin',
        )}
      />
    );
    onClick = () => {};
  } else if (speaking) {
    label = t('voice.voiceOutputSpeaking');
    actionLabel = t('voice.voiceOutputStop');
    icon = (
      <CircleStop
        className={cn(
          'text-primary size-4',
          !prefersReducedMotion && 'animate-pulse',
        )}
      />
    );
    onClick = player.stop;
  } else if (blocked) {
    label = t('voice.voiceOutputBlocked');
    actionLabel = t('voice.voiceOutputPlay');
    icon = <Volume2 className="size-4 text-amber-600" />;
  } else if (errored) {
    label = errorMessageForCode(player.errorCode, t);
    actionLabel = t('voice.voiceOutputPlay');
    icon = <AlertCircle className="text-destructive size-4" />;
  } else {
    // Idle with playable history — manual replay affordance.
    label = t('voice.voiceOutputStopped');
    actionLabel = t('voice.voiceOutputPlay');
    icon = <Volume2 className="size-4" />;
  }

  return (
    <>
      <Tooltip content={label} side="bottom">
        <Button
          variant="ghost"
          size="icon"
          className="p-1"
          aria-label={actionLabel}
          aria-pressed={speaking}
          onClick={onClick}
        >
          {icon}
        </Button>
      </Tooltip>
      <span className="sr-only" aria-live="polite">
        {label}
      </span>
    </>
  );
}

function errorMessageForCode(
  code: string | undefined,
  t: (key: string) => string,
): string {
  switch (code) {
    case 'NO_PROVIDER':
    case 'UNKNOWN_PROVIDER':
    case 'UNKNOWN_MODEL':
    case 'UNKNOWN_VOICE':
      return t('voice.voiceOutputErrorProvider');
    case 'RATE_LIMITED':
      return t('voice.voiceOutputErrorRateLimited');
    case 'BUDGET_EXCEEDED':
      return t('voice.voiceOutputErrorBudget');
    case 'TIMEOUT':
    case 'PROVIDER_5XX':
      return t('voice.voiceOutputErrorTransient');
    case 'PROVIDER_4XX':
    case 'HOST_POLICY':
    case 'PROVIDER_ERROR':
    default:
      return t('voice.voiceOutputError');
  }
}
