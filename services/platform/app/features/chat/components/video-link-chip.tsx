'use client';

import { AlertCircle, Loader2, RotateCcw, X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';

interface VideoLinkChipProps {
  job: VideoLinkJob;
  onCancel: () => void;
  onRetry: () => void;
}

const PROCESSING_STATUSES: ReadonlySet<string> = new Set([
  'queued',
  'retrying',
  'fetching_metadata',
  'fetching_captions',
  'extracting_audio',
  'transcribing_handoff',
  'indexing',
]);

/**
 * Video-link chip — renders in the chat-input attachment area for every
 * pasted URL. Visual language mirrors the existing audio-attachment chip
 * (lines 274-507 of chat-input.tsx) but stays a separate component for
 * blast-radius reasons. A follow-up will refactor both into a generic
 * `<AttachmentChip kind=...>`.
 *
 * Status mapping (from the reactive query's `displayStatus`):
 *   processing states → spinner + label
 *   completed         → checkmark + duration
 *   failed            → error icon + retry affordance
 *   skipped           → muted
 *
 * Tap targets are ≥44pt and the cancel/retry buttons are visible on
 * touch devices (not hover-gated) per the mobile B6 review.
 */
export function VideoLinkChip({ job, onCancel, onRetry }: VideoLinkChipProps) {
  const { t: tChat } = useT('chat');

  const isProcessing = PROCESSING_STATUSES.has(job.displayStatus);
  const isFailed = job.displayStatus === 'failed';
  const isCompleted = job.displayStatus === 'completed';

  // Status text priority (highest first):
  //   1. Failed   → localized error reason
  //   2. Completed → duration label
  //   3. Retrying with known cause → "Retrying… (bot detection)"
  //   4. Heartbeat progress set → raw progress (e.g. "transcribing chunk 2 of 4")
  //   5. Localized status label → fallback
  //
  // (4) prevents the "stuck on Transcribing…" anti-pattern — transcribe_audio
  // emits per-chunk progress via heartbeatJobByStorageId; the chip needs to
  // surface that rather than burying it under the static i18n label.
  // Server-side may emit a structured `__VL_ATTEMPT__N` progress token
  // for retry state instead of an English literal — resolve it to a
  // localized "Attempt N" string here. Other progress strings (Whisper
  // chunk progress) are still plain text and surfaced as-is.
  const renderedProgress = renderProgressToken(job.progress, tChat);
  const statusText = isFailed
    ? tChat(`videoLink.errors.${job.errorReasonCode ?? 'generic'}`, {
        defaultValue: tChat('videoLink.errors.generic'),
      })
    : isCompleted
      ? formatDurationLabel(job.videoDurationSec)
      : job.displayStatus === 'retrying' && job.errorReasonCode
        ? `${tChat('videoLink.statuses.retrying')} (${tChat(`videoLink.errors.${job.errorReasonCode}`, { defaultValue: tChat('videoLink.errors.generic') })})`
        : isProcessing && renderedProgress
          ? renderedProgress
          : tChat(`videoLink.statuses.${job.displayStatus}`, {
              defaultValue: tChat('videoLink.statuses.queued'),
            });

  const title = job.videoTitle ?? tChat('videoLink.chip.fallbackTitle');

  return (
    <div
      role="group"
      aria-label={tChat('videoLink.chip.ariaLabel', { title })}
      aria-busy={isProcessing}
      className={cn(
        // `max-w-full` keeps the chip inside its flex parent on every
        // viewport; `lg:max-w-md` caps it at ~448 px on desktop, matching
        // `message-bubble.tsx`'s user-bubble width — same breakpoint
        // prevents a sm-lg-viewport bounce where the chip is wider than
        // the bubble that replaces it on send.
        'group/chip flex max-w-full items-center gap-2 rounded-2xl border px-3 py-1.5 text-sm lg:max-w-md',
        isFailed
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-border bg-muted/40 text-foreground',
      )}
    >
      <span aria-hidden="true" className="shrink-0 text-base leading-none">
        🎬
      </span>
      <div className="flex min-w-0 flex-1 flex-col">
        {/* Open-source affordance: when the job carries a sourceUrl,
            wrap the title in an external link so the user can verify
            which video the chip represents after the pasted URL gets
            stripped from the textarea. `noopener noreferrer` blocks
            window.opener token theft and Referer leak.

            `line-clamp-2` (vs the previous `truncate`) lets long titles
            wrap to a second line with ellipsis, instead of overflowing
            the chip horizontally — the chip's max-w above caps width
            and this caps height. `break-words` lets URL-style or
            CJK-without-spaces titles break inside long runs. */}
        {job.sourceUrl ? (
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            // Visible focus ring — `focus-visible:underline` on its own
            // is not a sufficient SC 2.4.7 / 1.4.11 non-text-contrast
            // focus indicator. Mirror the icon buttons' ring style.
            className="focus-visible:ring-ring line-clamp-2 rounded font-medium break-words hover:underline focus-visible:ring-2 focus-visible:outline-none"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span className="line-clamp-2 font-medium break-words" title={title}>
            {title}
          </span>
        )}
        {/* Live region stays `polite` throughout — including during
            processing — so screen-reader users hear status transitions
            (queued → fetching → completed). Previously the region was
            silenced while `isProcessing`, which both swallowed the
            mount announcement and suppressed every phase-transition
            update. `aria-atomic=false` so a single token change inside
            the region doesn't reread the whole label on every tick. */}
        <span
          aria-live="polite"
          aria-atomic="false"
          className={cn(
            'flex items-center gap-1 truncate text-xs',
            isFailed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {/* Loader and error icons are decorative — the status text
              span carries the semantics via the live region above. */}
          {isProcessing && (
            <Loader2
              aria-hidden="true"
              className="size-3 shrink-0 motion-safe:animate-spin"
            />
          )}
          {isFailed && (
            <AlertCircle aria-hidden="true" className="size-3 shrink-0" />
          )}
          <span className="truncate">{statusText}</span>
        </span>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={tChat('videoLink.actions.retry')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-11 shrink-0 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
        >
          <RotateCcw className="size-4" />
        </button>
      )}
      <button
        type="button"
        onClick={onCancel}
        aria-label={tChat('videoLink.actions.removeLink')}
        className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
      >
        <X className="size-4" />
      </button>
    </div>
  );
}

function formatDurationLabel(durationSec: number | undefined): string {
  if (durationSec === undefined || durationSec <= 0) return '';
  const totalSec = Math.round(durationSec);
  const mm = Math.floor(totalSec / 60);
  const ss = totalSec % 60;
  return `${mm}:${String(ss).padStart(2, '0')}`;
}

/** Resolve server-side structured progress tokens to localized strings.
 * Currently only `__VL_ATTEMPT__N` is structured; other progress values
 * (Whisper chunk progress) are plain text and returned unchanged. */
function renderProgressToken(
  progress: string | undefined,
  tChat: (key: string, vars?: Record<string, unknown>) => string,
): string | undefined {
  if (!progress) return progress;
  const attemptMatch = /^__VL_ATTEMPT__(\d+)$/.exec(progress);
  if (attemptMatch) {
    return tChat('videoLink.statuses.attemptNumber', {
      n: attemptMatch[1],
    });
  }
  return progress;
}
