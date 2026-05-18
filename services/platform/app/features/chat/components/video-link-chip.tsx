'use client';

import { Loader2, RotateCcw, X } from 'lucide-react';

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
  const statusText = isFailed
    ? tChat(`videoLink.errors.${job.errorReasonCode ?? 'generic'}`, {
        defaultValue: tChat('videoLink.errors.generic'),
      })
    : isCompleted
      ? formatDurationLabel(job.videoDurationSec)
      : job.displayStatus === 'retrying' && job.errorReasonCode
        ? `${tChat('videoLink.statuses.retrying')} (${tChat(`videoLink.errors.${job.errorReasonCode}`, { defaultValue: tChat('videoLink.errors.generic') })})`
        : isProcessing && job.progress
          ? job.progress
          : tChat(`videoLink.statuses.${job.displayStatus}`, {
              defaultValue: tChat('videoLink.statuses.queued'),
            });

  const title = job.videoTitle ?? tChat('videoLink.chip.fallbackTitle');

  return (
    <div
      role="group"
      aria-label={tChat('videoLink.chip.ariaLabel', { title })}
      className={cn(
        'group/chip flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm',
        isFailed
          ? 'border-destructive/40 bg-destructive/5 text-destructive'
          : 'border-border bg-muted/40 text-foreground',
      )}
    >
      <span aria-hidden="true" className="text-base leading-none">
        🎬
      </span>
      <div className="flex min-w-0 flex-col">
        {/* Open-source affordance: when the job carries a sourceUrl,
            wrap the title in an external link so the user can verify
            which video the chip represents after the pasted URL gets
            stripped from the textarea. `noopener noreferrer` blocks
            window.opener token theft and Referer leak. */}
        {job.sourceUrl ? (
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate font-medium hover:underline focus-visible:underline focus-visible:outline-none"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span className="truncate font-medium" title={title}>
            {title}
          </span>
        )}
        <span
          aria-live={isProcessing ? 'off' : 'polite'}
          aria-atomic="true"
          className={cn(
            'flex items-center gap-1 text-xs',
            isFailed ? 'text-destructive' : 'text-muted-foreground',
          )}
        >
          {/* `motion-safe:` honours `prefers-reduced-motion`. Otherwise
              the spinner runs unconditionally for users who explicitly
              asked the OS to suppress animation. */}
          {isProcessing && (
            <Loader2 className="size-3 motion-safe:animate-spin" />
          )}
          {statusText}
        </span>
      </div>
      {isFailed && (
        <button
          type="button"
          onClick={onRetry}
          aria-label={tChat('videoLink.actions.retry')}
          className="text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex size-11 items-center justify-center rounded-full focus-visible:ring-2 focus-visible:outline-none"
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
