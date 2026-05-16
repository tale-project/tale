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

  // The surrounding `<ChatMessages>` already wraps the message stream in a
  // `role="log" aria-live="polite"` region. Nesting another `aria-live`
  // span here caused screen readers to over-announce: every state flip on
  // every assistant bubble fired through the parent log too, multiplied
  // by the number of mounted indicators. The button's `aria-label` plus
  // `aria-pressed` already convey the interactive state on focus; the
  // tooltip surfaces the human-readable label on hover.
  return (
    <Tooltip content={label} side="bottom">
      <Button
        variant="ghost"
        size="icon"
        className="p-1"
        aria-label={actionLabel}
        aria-pressed={speaking}
        // While the loading branch is active, `onClick` is a no-op. Mark
        // the button disabled so SR / keyboard users don't activate an
        // inert affordance (WCAG 4.1.2 Name/Role/Value). Visual styling
        // continues to show the spinner.
        disabled={showLoading}
        aria-busy={showLoading}
        onClick={onClick}
      >
        {icon}
      </Button>
    </Tooltip>
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
    // Synthetic client-side code raised by use-voice-output-player when
    // every server-ready chunk's `<audio>` element decode/fetch failed —
    // distinct from the server-classified codes above.
    case 'AUDIO_DECODE':
      return t('voice.voiceOutputErrorDecode');
    case 'PROVIDER_4XX':
    case 'HOST_POLICY':
    case 'PROVIDER_ERROR':
    default:
      return t('voice.voiceOutputError');
  }
}
