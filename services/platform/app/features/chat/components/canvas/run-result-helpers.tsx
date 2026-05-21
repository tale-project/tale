'use client';

// Shared presentation helpers for artifact run results. Used by both the
// canvas's `RunResultPanel` (primary + collapsible secondary projections)
// and any future consumer that needs the same status / file / live-tail
// chrome. Pure presentational — no Convex queries, no routing.

import { Badge } from '@tale/ui/badge';
import type { Infer } from 'convex/values';
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  Loader2,
  Presentation,
  FileText,
  FileSpreadsheet,
  File as FileIcon,
  Image as ImageIcon,
} from 'lucide-react';
import { useEffect, useRef } from 'react';

import {
  sandboxOutputFileValidator,
  sandboxRunProgressValidator,
  type SandboxErrorCode,
  type SandboxRunStatus,
} from '@/convex/sandbox/wire';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatFileSize } from '@/lib/utils/format/file';

import { useFileUrl } from '../../hooks/queries';

// Single source of truth: the same validators that gate the Convex
// mutations also derive the client-side prop types, so a future field
// addition on `sandboxOutputFileValidator` flows through without a
// matching hand-edit here.
export type RunOutputFile = Infer<typeof sandboxOutputFileValidator>;
export type RunProgress = Infer<typeof sandboxRunProgressValidator>;

function iconForContentType(contentType: string): typeof FileIcon {
  if (
    contentType ===
    'application/vnd.openxmlformats-officedocument.presentationml.presentation'
  ) {
    return Presentation;
  }
  if (
    contentType ===
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  ) {
    return FileSpreadsheet;
  }
  if (contentType === 'application/pdf') return FileText;
  if (contentType.startsWith('image/')) return ImageIcon;
  return FileIcon;
}

export function FileChip({ file }: { file: RunOutputFile }) {
  const { t } = useT('chat');
  const { data: fileUrl } = useFileUrl(file.storageId);
  const Icon = iconForContentType(file.contentType);
  const disabled = !fileUrl;
  return (
    <a
      href={fileUrl ?? '#'}
      download={file.name}
      target={fileUrl ? '_blank' : undefined}
      rel="noreferrer"
      aria-label={t('canvas.runOpenFile', { name: file.name })}
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={cn(
        'border-border bg-background hover:bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        disabled && 'opacity-60',
      )}
    >
      <Icon className="text-muted-foreground size-4 shrink-0" aria-hidden />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{file.name}</span>
        <span className="text-muted-foreground text-xs">
          {formatFileSize(file.size)}
        </span>
      </div>
      <Download
        className="text-muted-foreground size-3.5 shrink-0"
        aria-hidden
      />
    </a>
  );
}

// Stable icon component reference — passing an inline arrow `(props) => <Loader2 ... />`
// makes Badge re-mount the icon on every render, and during a streaming
// install that drips `runProgress` patches every few ms, the CSS spin
// animation visibly stutters because it resets on each remount. Hoisting
// to a module-scope component preserves identity (round-2 R2-B12).
function SpinningLoader(props: { className?: string }) {
  return <Loader2 {...props} className={cn(props.className, 'animate-spin')} />;
}

export function StatusBadge({
  runStatus,
  runProgress,
}: {
  runStatus?: SandboxRunStatus;
  runProgress?: RunProgress;
}) {
  const { t } = useT('chat');
  if (!runStatus) return null;
  if (runStatus === 'completed') {
    return (
      <Badge
        variant="outline"
        icon={CheckCircle2}
        className="text-success border-success/40"
        role="status"
        aria-live="polite"
      >
        {t('canvas.runDone')}
      </Badge>
    );
  }
  if (runStatus === 'failed' || runStatus === 'cancelled') {
    return (
      <Badge
        variant="outline"
        icon={AlertTriangle}
        className="text-destructive border-destructive/40"
        role="status"
        aria-live="polite"
      >
        {t(`canvas.runStatus.${runStatus}`)}
      </Badge>
    );
  }
  // queued / installing / running — live progress with spinner.
  // Always pass `package` and `version` keys (even when undefined): ICU's
  // `{version, select, undefined {} other { {version}}}` template throws
  // "context variable not provided" when the key is structurally absent
  // (round-2 R2-B12; verified empirically against intl-messageformat).
  // Passing `undefined` triggers the `undefined` branch as intended.
  const progressText = runProgress
    ? t(`canvas.runProgress.${runProgress.kind}`, {
        package: runProgress.package,
        version: runProgress.version,
      })
    : t(`canvas.runStatus.${runStatus}`);
  return (
    <Badge
      variant="outline"
      icon={SpinningLoader}
      className="border-border"
      role="status"
      aria-live="polite"
    >
      {progressText}
    </Badge>
  );
}

/**
 * stdout / stderr live tail. While `liveTail` is true (run in flight) the
 * `<details>` is force-open via an imperative ref-set so the user sees
 * output as it streams; once the flag drops, the prop is left undefined so
 * the user can collapse manually without React re-asserting the open state.
 *
 * Auto-scrolls the `<pre>` to the bottom on each content change, unless the
 * user has scrolled away from the bottom — a 32 px slack covers off-by-one
 * rounding from the browser's scrollHeight/scrollTop math.
 */
export function LiveTailDetails({
  text,
  label,
  liveTail,
  preClassName,
}: {
  text: string;
  label: string;
  liveTail: boolean;
  preClassName: string;
}) {
  const detailsRef = useRef<HTMLDetailsElement | null>(null);
  const preRef = useRef<HTMLPreElement | null>(null);
  const stickToBottomRef = useRef(true);

  useEffect(() => {
    if (liveTail && detailsRef.current && !detailsRef.current.open) {
      detailsRef.current.open = true;
    }
  }, [liveTail]);

  useEffect(() => {
    const el = preRef.current;
    if (!el) return;
    if (!stickToBottomRef.current) return;
    el.scrollTop = el.scrollHeight;
  }, [text]);

  return (
    <details ref={detailsRef} className="text-xs">
      <summary className="text-muted-foreground cursor-pointer font-medium">
        {label}
      </summary>
      <pre
        ref={preRef}
        onScroll={(e) => {
          const el = e.currentTarget;
          const distanceFromBottom =
            el.scrollHeight - el.clientHeight - el.scrollTop;
          stickToBottomRef.current = distanceFromBottom < 32;
        }}
        className={preClassName}
      >
        {text}
      </pre>
    </details>
  );
}

/**
 * One projected execution row from `listRunsPerFile`. Same shape as what
 * the legacy `getLatestRunPerFile` returned, kept here for callers that
 * want to derive their own UI without re-importing the projection's
 * exact field set from the Convex API surface.
 */
export interface RunFileProjection {
  executionId: unknown;
  path: string;
  runStatus?: SandboxRunStatus;
  runProgress?: RunProgress;
  runErrorCode?: SandboxErrorCode;
  runErrorMessage?: string;
  runStdoutPreview?: string;
  runStderrPreview?: string;
  runOutputFiles?: RunOutputFile[];
  runRevision?: number;
  runExitCode?: number;
}

/**
 * Stale-run guard: if the source was edited after the row's run, the
 * `runStatus` / progress chrome no longer reflects what the user sees in
 * the canvas, so we hide it. Output files survive the guard — they're a
 * concrete artifact of a past run, not a status claim.
 */
export function isRunFresh(
  fileRun: RunFileProjection | undefined,
  artifactRevision: number,
): boolean {
  return (
    fileRun !== undefined &&
    fileRun.runRevision !== undefined &&
    fileRun.runRevision === artifactRevision
  );
}

/**
 * Predicate matching the legacy renderer's `showExecutionPanel` logic —
 * mirrors "stay quiet until there's something to show" so we don't
 * surface bare headers during streaming or pre-first-run states.
 */
export function hasAnythingToShow(
  fileRun: RunFileProjection | undefined,
  fresh: boolean,
): boolean {
  if (!fileRun) return false;
  const runStatus = fresh ? fileRun.runStatus : undefined;
  const runErrorCode = fresh ? fileRun.runErrorCode : undefined;
  const stderr = fresh ? fileRun.runStderrPreview : undefined;
  const stdout = fresh ? fileRun.runStdoutPreview : undefined;
  const outputs = fileRun.runOutputFiles ?? [];
  return (
    runStatus !== undefined ||
    runErrorCode !== undefined ||
    outputs.length > 0 ||
    (stderr !== undefined && stderr.length > 0) ||
    (stdout !== undefined && stdout.length > 0)
  );
}

/**
 * Inner body of an execution panel — header (status badge + optional
 * label), error block, output files, stdout / stderr tails. Shared so the
 * primary entry-file panel and each collapsed secondary render the same
 * chrome.
 */
export function RunResultDetails({
  fileRun,
  fresh,
  showHeader = true,
  headerLabel,
}: {
  fileRun: RunFileProjection;
  fresh: boolean;
  showHeader?: boolean;
  /** Header text (defaults to `canvas.runStarted`). */
  headerLabel?: string;
}) {
  const { t } = useT('chat');
  const runStatus = fresh ? fileRun.runStatus : undefined;
  const runProgress = fresh ? fileRun.runProgress : undefined;
  const runErrorCode = fresh ? fileRun.runErrorCode : undefined;
  const runErrorMessage = fresh ? fileRun.runErrorMessage : undefined;
  const stdout = fresh ? fileRun.runStdoutPreview : undefined;
  const stderr = fresh ? fileRun.runStderrPreview : undefined;
  // Output files survive the freshness gate (download chip should remain
  // available even if a later edit made the source stale).
  const outputFiles: RunOutputFile[] = (fileRun.runOutputFiles ?? []).map(
    (f) => {
      const next: RunOutputFile = {
        name: f.name,
        size: f.size,
        contentType: f.contentType,
        fileMetadataId: f.fileMetadataId,
      };
      if (f.storageId !== undefined) next.storageId = f.storageId;
      return next;
    },
  );

  return (
    <div className="flex flex-col gap-3">
      {showHeader && (
        <div className="flex items-center justify-between">
          <span className="text-muted-foreground text-xs font-medium uppercase">
            {headerLabel ?? t('canvas.runStarted')}
          </span>
          <StatusBadge runStatus={runStatus} runProgress={runProgress} />
        </div>
      )}

      {runErrorCode && (
        <div
          className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-2 text-xs"
          role="alert"
        >
          <div className="font-semibold">
            {t(`canvas.runErrorCode.${runErrorCode}`)}
          </div>
          {runErrorMessage && (
            <div className="mt-1 break-words">{runErrorMessage}</div>
          )}
        </div>
      )}

      {outputFiles.length > 0 && (
        <div className="flex flex-col gap-2">
          <span className="text-muted-foreground text-xs font-medium">
            {t('canvas.runFiles')}
          </span>
          {outputFiles.map((f) => (
            <FileChip key={String(f.fileMetadataId)} file={f} />
          ))}
        </div>
      )}

      {stdout && stdout.length > 0 && (
        <LiveTailDetails
          text={stdout}
          label={t('canvas.runStdout', { chars: stdout.length })}
          liveTail={runStatus === 'installing' || runStatus === 'running'}
          preClassName="bg-muted/40 mt-1 max-h-40 overflow-auto rounded p-2 font-mono whitespace-pre-wrap"
        />
      )}

      {stderr && stderr.length > 0 && (
        <LiveTailDetails
          text={stderr}
          label={t('canvas.runStderr', { chars: stderr.length })}
          liveTail={
            runStatus === 'installing' ||
            runStatus === 'running' ||
            runStatus === 'failed'
          }
          preClassName="bg-muted/40 text-destructive mt-1 max-h-40 overflow-auto rounded p-2 font-mono whitespace-pre-wrap"
        />
      )}
    </div>
  );
}
