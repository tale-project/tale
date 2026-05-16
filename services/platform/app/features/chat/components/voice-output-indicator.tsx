'use client';

import { Button } from '@tale/ui/button';
import {
  AlertCircle,
  CircleStop,
  Loader2,
  Volume2,
  VolumeOff,
} from 'lucide-react';

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
    // Use a distinct icon (not Volume2 + tint) so the state is
    // perceivable to color-blind users and in monochrome
    // screenshots — WCAG 1.4.1 Use of Color. The amber tint stays as
    // a redundant cue but is no longer the sole differentiator from
    // the idle "Play" affordance.
    icon = <VolumeOff className="size-4 text-amber-600" />;
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
        // `min-h-11 min-w-11` for WCAG 2.2 AA Target Size — the prior
        // `p-1` button collapsed to ~24x24 css px which is well under
        // the 44x44 mobile minimum. Keep the icon at `size-4` so the
        // visual weight matches the rest of the message-bubble action
        // row; the extra padding sits invisibly around it.
        className="min-h-11 min-w-11"
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
    // CONTENTION is rate-limiter shard OCC, not quota — the chunker is
    // already retrying internally with short jitter. Surface as
    // transient so the user knows it's not stuck.
    case 'CONTENTION':
      return t('voice.voiceOutputErrorTransient');
    // Synthetic client-side code raised by use-voice-output-player when
    // every server-ready chunk's `<audio>` element decode/fetch failed —
    // distinct from the server-classified codes above.
    case 'AUDIO_DECODE':
      return t('voice.voiceOutputErrorDecode');
    case 'MESSAGE_CHAR_LIMIT':
      return t('voice.voiceOutputErrorMessageCharLimit');
    // `HOST_POLICY` (provider URL blocked by SSRF guard / private-IP
    // allowlist) and `forbidden` (membership / IDOR refusal) both mean
    // "the server refused to call out at all". Same recovery: ask an
    // admin to check provider config / network policy.
    case 'HOST_POLICY':
    case 'forbidden':
      return t('voice.voiceOutputErrorForbidden');
    case 'TTS_CHUNK_LIMIT':
    case 'TTS_TEXT_TOO_LONG':
    case 'TTS_EMPTY_TEXT':
      return t('voice.voiceOutputErrorChunkLimit');
    case 'PROVIDER_4XX':
    case 'PROVIDER_ERROR':
    default:
      return t('voice.voiceOutputError');
  }
}
