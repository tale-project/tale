'use client';

// Canvas pane for `python_runnable` / `node_runnable` artifacts.
// Left side shows the source code (re-uses CanvasCodeRenderer). Right
// side shows the live execution state — progress chip while the spawner
// streams PHASE events, then stdout preview + downloadable output-file
// chips on completion (or errorCode + stderr tail on failure).
//
// Every user-visible string is keyed via `useT('chat')` against the
// `canvas.run*` / `canvas.runStatus.*` / `canvas.runErrorCode.*` /
// `canvas.runProgress.*` namespaces. The server never writes English
// (or any other) literals into `runProgress`; it writes a structured
// `{kind, package?, version?}` shape and we render it here via ICU.

import { Badge } from '@tale/ui/badge';
import { useQuery } from 'convex/react';
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

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
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
import { CanvasCodeRenderer } from './canvas-code-renderer';

// Single source of truth: the same validators that gate the Convex
// mutations also derive the client-side prop types, so a future field
// addition on `sandboxOutputFileValidator` flows through without a
// matching hand-edit here.
type RunOutputFile = Infer<typeof sandboxOutputFileValidator>;
type RunProgress = Infer<typeof sandboxRunProgressValidator>;

interface CanvasRunnableCodeRendererProps {
  artifactId: Id<'artifacts'>;
  /**
   * Path of the file the user has selected in the sidebar. Drives the
   * per-file run-state query so switching to a sibling script (e.g.
   * `verify.js`) shows its own outputs without clobbering `main.js`'s
   * download chip.
   */
  activePath: string;
  source: string;
  language: 'python' | 'node';
  isStreaming?: boolean;
}

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

function FileChip({ file }: { file: RunOutputFile }) {
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

function StatusBadge({
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

function CanvasRunnableCodeRendererComponent({
  artifactId,
  activePath,
  source,
  language,
  isStreaming,
}: CanvasRunnableCodeRendererProps) {
  const { t } = useT('chat');
  const artifact = useQuery(api.artifacts.queries.getById, { artifactId });
  // Per-file run-state query. Returns the most recent `sandboxExecutions`
  // row matching `(artifactId, activePath)`, projected into the same
  // shape as the legacy `artifact.run*` fields. Falls back to the artifact
  // row on legacy data (pre-`path` column).
  const fileRun = useQuery(api.artifacts.queries.getLatestRunPerFile, {
    artifactId,
    path: activePath,
  });
  // Stale-run guard: if the source was edited after the last run, the
  // displayed `run*` fields no longer reflect what the user sees. Treat
  // them as absent so the renderer prompts a re-run rather than showing
  // stale output (round-2 R2-B10). When `runRevision` is undefined the
  // artifact hasn't been run yet — same effect.
  const runIsFresh =
    artifact !== undefined &&
    artifact !== null &&
    fileRun !== undefined &&
    fileRun !== null &&
    fileRun.runRevision !== undefined &&
    fileRun.runRevision === artifact.revision;
  const runStatus: SandboxRunStatus | undefined = runIsFresh
    ? fileRun?.runStatus
    : undefined;
  const runProgress: RunProgress | undefined = runIsFresh
    ? fileRun?.runProgress
    : undefined;
  const runErrorCode: SandboxErrorCode | undefined = runIsFresh
    ? fileRun?.runErrorCode
    : undefined;
  const runErrorMessage = runIsFresh ? fileRun?.runErrorMessage : undefined;
  const stdoutPreview = runIsFresh ? fileRun?.runStdoutPreview : undefined;
  const stderrPreview = runIsFresh ? fileRun?.runStderrPreview : undefined;
  // Output files: show ANY recorded run's outputs as long as they exist
  // (don't gate on freshness here). The download chip should remain
  // available for completed runs of *this file* even if a later run on
  // another file (or an edit) made the source stale — that's the whole
  // point of per-file run history. Stale freshness still hides progress /
  // error chrome above, but a downloaded `.pptx` stays one click away.
  const outputFiles: RunOutputFile[] = (fileRun?.runOutputFiles ?? []).map(
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

  // Hide the execution panel entirely while there's nothing to show — i.e.
  // during source streaming (artifact_create still authoring), after
  // artifact_create settles but before artifact_run has been invoked, OR
  // when an edit made the prior run stale. The bare "Run" header with no
  // body felt empty / confusing in user testing.
  const showExecutionPanel =
    runStatus !== undefined ||
    runErrorCode !== undefined ||
    outputFiles.length > 0 ||
    (stderrPreview !== undefined && stderrPreview.length > 0) ||
    (stdoutPreview !== undefined && stdoutPreview.length > 0);

  // Execution panel always sits ABOVE the source code so the file chip is
  // visible immediately. We deliberately do NOT use Tailwind `md:` responsive
  // prefixes for layout switching here — those are viewport-based, but the
  // canvas pane has its own constrained width (320-900px) independent of
  // viewport, so a side-by-side md: layout would mis-trigger on wide
  // viewports with narrow canvases (the panel ends up squeezed off-screen).
  return (
    <div className="flex h-full min-h-0 flex-col">
      {showExecutionPanel && (
        <div className="border-border bg-muted/10 flex shrink-0 flex-col gap-3 overflow-auto border-b p-4">
          <div className="flex items-center justify-between">
            <span className="text-muted-foreground text-xs font-medium uppercase">
              {t('canvas.runStarted')}
            </span>
            <StatusBadge runStatus={runStatus} runProgress={runProgress} />
          </div>

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

          {stdoutPreview && stdoutPreview.length > 0 && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer font-medium">
                {t('canvas.runStdout', { chars: stdoutPreview.length })}
              </summary>
              <pre className="bg-muted/40 mt-1 max-h-40 overflow-auto rounded p-2 font-mono whitespace-pre-wrap">
                {stdoutPreview}
              </pre>
            </details>
          )}

          {stderrPreview && stderrPreview.length > 0 && (
            <details className="text-xs" open={runStatus === 'failed'}>
              <summary className="text-muted-foreground cursor-pointer font-medium">
                {t('canvas.runStderr', { chars: stderrPreview.length })}
              </summary>
              <pre className="bg-muted/40 text-destructive mt-1 max-h-40 overflow-auto rounded p-2 font-mono whitespace-pre-wrap">
                {stderrPreview}
              </pre>
            </details>
          )}
        </div>
      )}

      <div className="min-h-0 flex-1">
        <CanvasCodeRenderer
          code={source}
          language={language}
          isEditing={false}
          isStreaming={isStreaming ?? false}
          onContentChange={() => {
            /* runnable canvas is read-only; LLM-driven via artifact_edit */
          }}
        />
      </div>
    </div>
  );
}

// No memo wrapper: during a sandbox run the artifact row changes via
// reactive useQuery on every progress event, so the parent re-renders
// for every chunk and memo's shallow equality check never passes.
// `memo()` here was pure overhead.
export const CanvasRunnableCodeRenderer = CanvasRunnableCodeRendererComponent;
