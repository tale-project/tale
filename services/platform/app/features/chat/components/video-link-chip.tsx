'use client';

import { Stack } from '@tale/ui/layout';
import { AlertCircle, Loader2, X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { VideoLinkJob } from '../hooks/use-chat-video-links';

interface VideoLinkChipProps {
  job: VideoLinkJob;
  /** Omit to hide the chip's own ✕ — the queued-send tray does this
   * because its row already carries the whole-message cancel; two ✕ with
   * different scopes on one line read as duplicates. */
  onCancel?: () => void;
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
 * A pasted video URL, as a composer chip (0.3's treatment): title links back
 * to the source, the status line live-tracks the ingest phases, a failed job
 * offers retry, and ✕ cancels. The transcript rides the send as an
 * audio-lane attachment once ready.
 */
export function VideoLinkChip({ job, onCancel, onRetry }: VideoLinkChipProps) {
  const { t } = useT('chat');

  const isProcessing = PROCESSING_STATUSES.has(job.displayStatus);
  const isFailed = job.displayStatus === 'failed';
  const isCompleted = job.displayStatus === 'completed';

  const renderedProgress = renderProgressToken(job.progress, t);
  const statusText = isFailed
    ? t(`videoLink.errors.${job.errorReasonCode ?? 'generic'}`, {
        defaultValue: t('videoLink.errors.generic'),
      })
    : isCompleted
      ? formatDurationLabel(job.videoDurationSec) ||
        t('videoLink.statuses.completed')
      : job.displayStatus === 'retrying' && job.errorReasonCode
        ? `${t('videoLink.statuses.retrying')} (${t(
            `videoLink.errors.${job.errorReasonCode}`,
            { defaultValue: t('videoLink.errors.generic') },
          )})`
        : isProcessing && renderedProgress
          ? renderedProgress
          : t(`videoLink.statuses.${job.displayStatus}`, {
              defaultValue: t('videoLink.statuses.queued'),
            });

  const title = job.videoTitle ?? t('videoLink.chip.fallbackTitle');

  return (
    <div
      role="group"
      aria-label={t('videoLink.chip.ariaLabel', { title })}
      aria-busy={isProcessing}
      className={cn(
        // A failed chip carries a full sentence plus an expandable detail —
        // give it room (0.3 capped at ~max-w-md too) instead of ellipsing
        // the reason into "blocked aut…".
        'border-border bg-muted/40 flex h-auto min-h-9 max-w-full shrink-0 items-center gap-2 rounded-lg border px-2 py-1 lg:max-w-md',
        isFailed && 'border-destructive/40 bg-destructive/5',
      )}
    >
      {isProcessing ? (
        <Loader2
          aria-hidden
          className="text-muted-foreground size-3.5 shrink-0 animate-spin motion-reduce:animate-none"
        />
      ) : isFailed ? (
        <AlertCircle
          aria-hidden
          className="text-destructive size-3.5 shrink-0"
        />
      ) : (
        <span aria-hidden className="shrink-0 text-sm leading-none">
          🎬
        </span>
      )}
      <Stack gap={0} className="min-w-0 flex-1">
        {/* The token leaves the textarea on send, so the linked title is the
            user's only way back to the source video. */}
        {job.sourceUrl ? (
          <a
            href={job.sourceUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-foreground focus-visible:ring-ring block truncate rounded text-xs font-medium hover:underline focus-visible:ring-2 focus-visible:outline-none"
            title={title}
          >
            {title}
          </a>
        ) : (
          <span
            className="text-foreground block truncate text-xs font-medium"
            title={title}
          >
            {title}
          </span>
        )}
        <span
          aria-live="polite"
          aria-atomic="false"
          className={cn(
            'block text-[10px] leading-tight',
            // The failed reason is the one line the user must actually read
            // — let it wrap instead of ellipsing mid-word.
            isFailed
              ? 'text-destructive line-clamp-2 break-words'
              : 'text-muted-foreground truncate',
          )}
        >
          {statusText}
        </span>
        {/* Verbatim failure detail, click-to-expand (0.3's collapsible).
            Safe to show: scrubbed server-side and capped at 500 chars
            before it reaches the row. */}
        {isFailed &&
          job.errorMessage !== undefined &&
          job.errorMessage.length > 0 && (
            <details className="text-[10px]">
              <summary className="text-muted-foreground hover:text-foreground cursor-pointer select-none">
                {t('errorDetailsSummary')}
              </summary>
              <p className="text-muted-foreground mt-0.5 font-mono break-all whitespace-pre-wrap opacity-80">
                {job.errorMessage}
              </p>
            </details>
          )}
      </Stack>
      {isFailed && (
        <button
          type="button"
          onClick={onRetry}
          className="text-muted-foreground hover:text-foreground shrink-0 text-[10px] underline"
        >
          {t('videoLink.actions.retry')}
        </button>
      )}
      {onCancel !== undefined && (
        <button
          type="button"
          onClick={onCancel}
          aria-label={t('videoLink.actions.removeLink')}
          className="text-muted-foreground hover:text-foreground flex size-4 shrink-0 items-center justify-center"
        >
          <X aria-hidden className="size-3" />
        </button>
      )}
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

/** Resolve the server's structured `__VL_ATTEMPT__N` retry token to a
 * localized label; other progress strings pass through as-is. */
function renderProgressToken(
  progress: string | undefined,
  t: (key: string, vars?: Record<string, unknown>) => string,
): string | undefined {
  if (progress === undefined || progress.length === 0) return progress;
  const attemptMatch = /^__VL_ATTEMPT__(\d+)$/.exec(progress);
  if (attemptMatch) {
    return t('videoLink.statuses.attemptNumber', { n: attemptMatch[1] });
  }
  return progress;
}
