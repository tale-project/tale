'use client';

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { Link } from '@tanstack/react-router';
import {
  AlertCircle,
  CircleStop,
  Loader2,
  Settings,
  Volume2,
  VolumeOff,
} from 'lucide-react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { usePrefersReducedMotion } from '@/app/hooks/use-prefers-reduced-motion';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useVoiceOutputPlayer } from '../hooks/use-voice-output-player';
import { errorMessageForCode } from '../utils/voice-error-messages';

interface VoiceOutputIndicatorProps {
  enabled: boolean;
  messageId: string | undefined;
  threadId: string | undefined;
  isStreaming: boolean;
  /**
   * `organizationId` for the message's org — used to build the
   * "Open settings" link's path when a CONFIG-class error surfaces.
   * Optional because legacy threads / fallback callsites may not have
   * one; without it, config errors fall back to a non-interactive badge
   * (still readable, just not actionable).
   */
  organizationId?: string;
  /**
   * True when this message's id was NOT in the chat list's first-
   * render snapshot — i.e. it arrived during this mount and is
   * eligible for voice-led reveal. Used to KEEP the "Preparing
   * voice…" chip visible through the race window between
   * `isStreaming → false` and the chunker's post-stream batch
   * action returning the first pending chunk row. Without this, the
   * chip blinked off and back on as observed.
   */
  isFreshSinceMount: boolean;
}

type ErrorCategory = 'retryable' | 'config' | 'terminal';

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
 *  - `'error'`   → branched by classification:
 *      retryable codes → alert + Click-to-retry button
 *      config codes    → alert + Link to AI providers settings (no retry)
 *      terminal codes  → alert badge (non-interactive — replay would
 *                        immediately re-trip the same per-reply cap)
 *
 * Each state announces itself via the chat-level `<VoiceOutputAnnouncer>`
 * so SR users get parity with the visual cue.
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
  // Show "Preparing voice…" until the FIRST ready chunk arrives. Covers
  // three windows the prior gates missed:
  //   - Streaming finished but synth still in flight (pending chunks
  //     exist but none ready yet) — previously dropped to idle "Play".
  //   - Pending chunk created mid-stream — previously flipped to idle
  //     "Play" the moment `chunks.length` went non-zero.
  //   - The race between `isStreaming → false` and the chunker's
  //     post-stream batch action returning. During this gap the
  //     indicator briefly had no pending chunks AND no streaming
  //     signal, so it returned `null` and blinked off. Including
  //     `isFreshSinceMount` keeps the chip stable across the gap —
  //     a fresh message with voice on is ALWAYS in the prep state
  //     until either a ready chunk or an error surfaces.
  // The transition Preparing → Speaking → idle Play now happens on one
  // continuous chip without any "Play" flash before audio actually
  // starts.
  const showLoading =
    !player.hasReadyChunk &&
    !player.errorCode &&
    (props.isStreaming || player.hasPendingChunk || props.isFreshSinceMount);
  if (
    !player.hasReadyChunk &&
    !player.hasPendingChunk &&
    !props.isStreaming &&
    !props.isFreshSinceMount &&
    !player.errorCode
  ) {
    return null;
  }

  const speaking = player.state === 'playing';
  const blocked = player.state === 'blocked';
  const errored = player.state === 'error' || player.errorCode !== undefined;

  // Branch on the error class instead of mapping every code to a retry
  // button. Config errors (no provider, host-policy, forbidden) cannot
  // be fixed by re-running the synthesize action; terminal errors
  // (budget exceeded, per-reply char/chunk cap, queue overflow) would
  // immediately re-trip if retried.
  if (errored) {
    const reason = errorMessageForCode(player.errorCode, t);
    const category = classifyErrorCode(player.errorCode);
    if (category === 'config') {
      const linkBody = (
        <span className="flex items-center gap-1">
          <Settings className="size-4" aria-hidden />
          <span className="text-xs">
            {t('voice.voiceOutputErrorOpenSettings')}
          </span>
        </span>
      );
      if (props.organizationId) {
        return (
          <Tooltip content={reason} side="bottom">
            <Link
              to="/dashboard/$id/settings/providers"
              params={{ id: props.organizationId }}
              className="text-destructive hover:text-destructive/80 inline-flex min-h-11 min-w-11 items-center justify-center underline"
              aria-label={`${reason}. ${t('voice.voiceOutputErrorOpenSettings')}`}
            >
              {linkBody}
            </Link>
          </Tooltip>
        );
      }
      // Without an `organizationId` the link can't be built; render the
      // reason inline on the badge so keyboard / touch users still see it.
      // No Tooltip wrapper: the badge text already carries the reason,
      // and a hover-only Tooltip on a non-focusable element is
      // unreachable by keyboard (round-1 / round-2 HIGH #32).
      return (
        <Badge variant="destructive" className="text-xs" role="status">
          <AlertCircle className="text-destructive size-4" aria-hidden />
          <span className="ml-1">{reason}</span>
        </Badge>
      );
    }
    if (category === 'terminal') {
      // The reason is rendered inline on the badge — Tooltip would be
      // redundant duplicated text AND unreachable by keyboard (the badge
      // isn't focusable). Drop the Tooltip wrapper. `role="alert"` is
      // kept so SRs announce the terminal state on appearance.
      return (
        <Badge
          variant="destructive"
          className="text-xs"
          role="alert"
          aria-label={reason}
        >
          <AlertCircle className="text-destructive size-4" aria-hidden />
          <span className="ml-1">{reason}</span>
        </Badge>
      );
    }
    // Retryable: keep the click-to-retry affordance.
    return (
      <Tooltip content={reason} side="bottom">
        <Button
          variant="ghost"
          size="icon"
          className="min-h-11 min-w-11"
          aria-label={reason}
          onClick={player.play}
        >
          <AlertCircle className="text-destructive size-4" />
        </Button>
      </Tooltip>
    );
  }

  // State-distinct styling. The voice control was previously a uniform
  // `ghost`-variant icon button — visually indistinguishable from the
  // copy / 👍 / 👎 row. Per industry research (ChatGPT moved AWAY from
  // a separate voice screen in Nov 2025; VUI design principles call
  // for prominent voice affordances inside hybrid interfaces), make
  // each state visually distinct AND make the playable / playing
  // states the dominant affordance in the bubble:
  //  - `playing`  → solid primary fill + stop icon + inline "Speaking…"
  //                 text label so the audio source is unmistakable
  //  - `idle`     → primary-tinted secondary chip so "tap to listen"
  //                 reads as an action, not decoration
  //  - `loading`  → muted spinner (was OK; just enlarged)
  //  - `blocked`  → amber accent + VolumeOff (unchanged colour, larger)
  let label: string;
  let actionLabel: string;
  let icon: React.ReactNode;
  let buttonVariant: 'primary' | 'secondary' | 'ghost' = 'ghost';
  let buttonClassName = 'min-h-12 min-w-12';
  let showSpeakingLabel = false;
  let showLoadingLabel = false;
  let onClick: () => void = player.play;

  if (showLoading) {
    label = t('voice.voiceOutputLoading');
    actionLabel = label;
    icon = (
      <Loader2
        className={cn('size-5', !prefersReducedMotion && 'animate-spin')}
      />
    );
    onClick = () => {};
    // Match the Speaking chip's shape (chip-with-label, not bare icon)
    // so the Preparing → Speaking transition feels like one control
    // changing state, not a separate icon being replaced. Muted tones
    // keep "I'm not interactive yet" visually distinct from the active
    // primary fill of the Speaking state.
    buttonVariant = 'secondary';
    buttonClassName = cn(
      buttonClassName,
      'bg-muted text-muted-foreground hover:bg-muted gap-2 px-4 cursor-default',
    );
    showLoadingLabel = true;
  } else if (speaking) {
    label = t('voice.voiceOutputSpeaking');
    actionLabel = t('voice.voiceOutputStop');
    icon = (
      <CircleStop
        className={cn('size-5', !prefersReducedMotion && 'animate-pulse')}
      />
    );
    onClick = player.stop;
    // Use `ghost` variant + explicit primary-fill className: the
    // built-in `primary` variant resolves to a gradient accent
    // (`bg-accent-base` + gradient overlay), which conflicted with
    // the inline `bg-primary` className override and produced a
    // fragile class-merge dependent on Tailwind ordering. Switching
    // to `ghost` (no built-in background) gives the className full
    // control over the surface — solid primary fill, no gradient
    // fragment, no order dependence. M10.
    buttonVariant = 'ghost';
    buttonClassName = cn(
      buttonClassName,
      'bg-primary text-primary-foreground hover:bg-primary/90 gap-2 px-4',
    );
    showSpeakingLabel = true;
  } else if (blocked) {
    label = t('voice.voiceOutputBlocked');
    actionLabel = t('voice.voiceOutputPlay');
    // Use a distinct icon (not Volume2 + tint) so the state is
    // perceivable to color-blind users and in monochrome
    // screenshots — WCAG 1.4.1 Use of Color. The amber tint stays as
    // a redundant cue but is no longer the sole differentiator from
    // the idle "Play" affordance.
    icon = <VolumeOff className="size-5 text-amber-600" />;
    // Surface the amber affordance on the BUTTON, not just the icon
    // stroke — without this the chip rendered as a bare `'ghost'`
    // (the initial default) and was visually indistinguishable from
    // the idle "Play" state for users who don't look at the icon
    // directly. M10.
    buttonVariant = 'secondary';
    buttonClassName = cn(
      buttonClassName,
      'bg-amber-50 text-amber-700 hover:bg-amber-100 border border-amber-200',
    );
  } else {
    // Idle with playable history — manual replay affordance.
    label = t('voice.voiceOutputStopped');
    actionLabel = t('voice.voiceOutputPlay');
    icon = <Volume2 className="size-5" />;
    buttonVariant = 'secondary';
    buttonClassName = cn(
      buttonClassName,
      'bg-primary/10 text-primary hover:bg-primary/15',
    );
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
        variant={buttonVariant}
        size={showSpeakingLabel || showLoadingLabel ? 'sm' : 'icon'}
        // Enlarged from the prior `min-h-11 min-w-11` to give voice
        // controls more visual weight than the copy/like/branch
        // toolbar row. WCAG 2.2 AA target-size minimum (44 css px) is
        // still satisfied at `min-h-12 min-w-12`.
        className={buttonClassName}
        aria-label={actionLabel}
        // `aria-pressed` is only meaningful on the speaking branch —
        // there it's a toggle (press to stop). On idle / loading /
        // blocked the button is a one-shot "Play" affordance; setting
        // `aria-pressed={false}` would cause AT to announce "not
        // pressed" on a non-toggle, misrepresenting the role. Pass
        // `undefined` to omit the attribute entirely on those branches.
        // M10.
        aria-pressed={speaking ? true : undefined}
        // While the loading branch is active, `onClick` is a no-op. Mark
        // the button disabled so SR / keyboard users don't activate an
        // inert affordance (WCAG 4.1.2 Name/Role/Value). Visual styling
        // continues to show the spinner.
        disabled={showLoading}
        aria-busy={showLoading}
        onClick={onClick}
      >
        {icon}
        {showSpeakingLabel ? (
          <span className="text-sm font-medium">
            {t('voice.voiceOutputSpeaking')}
          </span>
        ) : showLoadingLabel ? (
          <span className="text-sm font-medium">
            {t('voice.voiceOutputLoading')}
          </span>
        ) : null}
      </Button>
    </Tooltip>
  );
}

/**
 * Classify a TTS error code into one of three recovery categories:
 *
 *  - `'retryable'` — codes where the action might succeed if invoked
 *    again (rate-limit, transient outage, decode glitch). The indicator
 *    renders a click-to-retry button.
 *  - `'config'` — codes whose root cause is provider configuration
 *    (no provider, host-policy block, forbidden). The indicator renders
 *    a link to the AI providers settings page. Retrying would
 *    immediately re-fail.
 *  - `'terminal'` — codes that cap the *current* message (budget,
 *    per-message char limit, queue overflow). Retrying the same chunk
 *    would re-trip the same gate. The indicator renders a non-
 *    interactive badge.
 */
function classifyErrorCode(code: string | undefined): ErrorCategory {
  switch (code) {
    case 'NO_PROVIDER':
    case 'UNKNOWN_PROVIDER':
    case 'UNKNOWN_MODEL':
    case 'UNKNOWN_VOICE':
    case 'HOST_POLICY':
    case 'forbidden':
      return 'config';
    case 'BUDGET_EXCEEDED':
    case 'MESSAGE_CHAR_LIMIT':
    case 'TTS_CHUNK_LIMIT':
    case 'TTS_TEXT_TOO_LONG':
    case 'TTS_EMPTY_TEXT':
    case 'QUEUE_OVERFLOW':
      return 'terminal';
    default:
      // RATE_LIMITED, CONTENTION, TIMEOUT, PROVIDER_5XX, PROVIDER_4XX,
      // PROVIDER_ERROR, AUDIO_DECODE, UNKNOWN_NETWORK, undefined.
      return 'retryable';
  }
}

// `errorMessageForCode` moved to `../utils/voice-error-messages` — shared
// with the announcer so a code added in one place can't fall through to
// the generic fallback in the other.
