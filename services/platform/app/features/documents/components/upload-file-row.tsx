'use client';

import { Row } from '@tale/ui/layout';
import { CircleAlert, CircleCheck, Loader2, RotateCw, X } from 'lucide-react';
import { memo } from 'react';

import { useT } from '@/lib/i18n/client';
import { getDisplayExtension } from '@/lib/shared/file-types';
import { cn } from '@/lib/utils/cn';
import { formatBytes } from '@/lib/utils/format/number';

import type { FileUploadStatus } from '../hooks/mutations';

// ---------------------------------------------------------------------------
// File type badge color mapping
// ---------------------------------------------------------------------------

const BADGE_COLORS: Record<string, string> = {
  PDF: 'bg-red-600',
  DOC: 'bg-blue-600',
  DOCX: 'bg-blue-600',
  XLS: 'bg-green-600',
  XLSX: 'bg-green-600',
  CSV: 'bg-gray-400',
  PPT: 'bg-orange-500',
  PPTX: 'bg-orange-500',
  TXT: 'bg-gray-400',
  FILE: 'bg-gray-400',
};

function getTypeBadgeColor(ext: string): string {
  return BADGE_COLORS[ext] ?? 'bg-gray-400';
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface UploadFileRowProps {
  fileName: string;
  fileSize: number;
  status: FileUploadStatus;
  bytesLoaded: number;
  bytesTotal: number;
  error?: string;
  /** Legacy format (e.g. .doc/.ppt/.xls): uploads and is downloadable, but has
   *  no text extractor so it won't be indexed for search. Shown as a hint. */
  notIndexable?: boolean;
  onRetry?: () => void;
  onRemove?: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export const UploadFileRow = memo(function UploadFileRow({
  fileName,
  fileSize,
  status,
  bytesLoaded,
  bytesTotal,
  error,
  notIndexable,
  onRetry,
  onRemove,
}: UploadFileRowProps) {
  const { t } = useT('documents');
  const { t: tCommon } = useT('common');
  const ext = getDisplayExtension(fileName);
  const percentage =
    bytesTotal > 0 ? Math.round((bytesLoaded / bytesTotal) * 100) : 0;
  const isFailed = status === 'failed';
  const isCompleted = status === 'completed';
  const isUploading = status === 'uploading';
  // Bytes all sent, waiting for the store/records — byte progress is over,
  // so the bar goes indeterminate and the copy says "confirming" instead of
  // freezing at 100 % (which reads as "stuck" during a slow-uplink drain).
  const isFinalizing = status === 'finalizing';
  const isPending = status === 'pending';

  return (
    <div
      className={cn(
        'flex flex-col gap-2 rounded-lg border p-2.5 px-3',
        isFailed && 'border-red-200 bg-red-50',
        !isFailed && 'border-border bg-background',
      )}
    >
      {/* File info row */}
      <Row gap={2}>
        {/* Type badge */}
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded px-1 py-0.5 text-[9px] font-bold tracking-wide text-white leading-none',
            isFailed
              ? 'bg-red-600'
              : isPending
                ? 'bg-gray-400'
                : getTypeBadgeColor(ext),
          )}
        >
          {ext}
        </span>

        {/* File name */}
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-xs font-medium',
            isFailed
              ? 'text-red-600'
              : isPending
                ? 'text-muted-foreground'
                : 'text-foreground',
          )}
        >
          {isFailed ? t('upload.failedFileName', { fileName }) : fileName}
        </span>

        {/* Size info */}
        <span
          className={cn(
            'shrink-0 text-[11px] tabular-nums',
            isFailed
              ? 'text-red-600'
              : isUploading
                ? 'text-muted-foreground'
                : isPending
                  ? 'text-muted-foreground/70'
                  : 'text-muted-foreground',
          )}
        >
          {isUploading
            ? `${formatBytes(bytesLoaded)} / ${formatBytes(bytesTotal)}`
            : formatBytes(fileSize)}
        </span>

        {/* Status indicator / actions */}
        {isCompleted && (
          <CircleCheck
            className="size-3.5 shrink-0 text-green-700"
            aria-label={tCommon('aria.completed')}
          />
        )}

        {isUploading && (
          <span className="shrink-0 text-[11px] font-bold text-blue-600 tabular-nums">
            {percentage}%
          </span>
        )}

        {isFinalizing && (
          <span className="inline-flex shrink-0 items-center gap-1 text-[11px] font-medium text-blue-600">
            <Loader2
              className="size-3 motion-safe:animate-spin"
              aria-hidden="true"
            />
            {t('upload.confirming')}
          </span>
        )}

        {isFailed && onRetry && (
          <button
            type="button"
            onClick={onRetry}
            className="inline-flex shrink-0 items-center gap-1 rounded bg-red-600 px-1.5 py-0.5 text-[10px] font-semibold text-white transition-colors hover:bg-red-700"
          >
            <RotateCw className="size-2.5" />
            {t('upload.retry')}
          </button>
        )}

        {isPending && onRemove && (
          <button
            type="button"
            onClick={onRemove}
            className="bg-muted hover:bg-muted-foreground/20 inline-flex size-4 shrink-0 items-center justify-center rounded-full transition-colors"
            aria-label={tCommon('aria.removeNamed', { name: fileName })}
          >
            <X className="text-muted-foreground size-2.5" />
          </button>
        )}
      </Row>

      {/* Progress bar: determinate while bytes flow, indeterminate while
          confirming (no aria-valuenow — there is no meaningful value). */}
      {isUploading && (
        <div
          role="progressbar"
          aria-valuenow={bytesLoaded}
          aria-valuemin={0}
          aria-valuemax={bytesTotal}
          aria-label={t('upload.uploadingFileNamed', { fileName })}
          className="bg-muted h-1 w-full overflow-hidden rounded-full"
        >
          <div
            className="h-full rounded-full bg-gradient-to-b from-blue-600 to-blue-400 transition-all duration-300 ease-out"
            style={{ width: `${percentage}%` }}
          />
        </div>
      )}
      {isFinalizing && (
        <div
          role="progressbar"
          aria-label={t('upload.confirmingFileNamed', { fileName })}
          className="bg-muted h-1 w-full overflow-hidden rounded-full"
        >
          <div className="h-full w-full rounded-full bg-gradient-to-b from-blue-600 to-blue-400 motion-safe:animate-pulse" />
        </div>
      )}

      {/* Error message (only for failed) */}
      {isFailed && error && (
        <div className="flex items-start gap-1.5">
          <CircleAlert className="mt-px size-3.5 shrink-0 text-red-600" />
          <span className="text-[11px] leading-snug text-red-800">{error}</span>
        </div>
      )}

      {/* Legacy-format hint: stored but not searchable. Hidden once the row
          fails (the error message takes over). */}
      {notIndexable && !isFailed && (
        <span className="text-muted-foreground text-[11px] leading-snug">
          {t('upload.storedButNotIndexed')}
        </span>
      )}
    </div>
  );
});
