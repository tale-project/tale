'use client';

// Canvas pane for `python_runnable` / `node_runnable` artifacts (Refinement
// 2). Left side shows the source code (re-uses CanvasCodeRenderer). Right
// side shows the live execution state — progress chip while the spawner
// streams PHASE events, then stdout preview + downloadable output-file
// chips on completion (or errorCode + stderr tail on failure).

import { Badge } from '@tale/ui/badge';
import { useQuery } from 'convex/react';
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
import { memo } from 'react';

import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { formatFileSize } from '@/lib/utils/format/file';

import { useFileUrl } from '../../hooks/queries';
import { CanvasCodeRenderer } from './canvas-code-renderer';

interface RunOutputFile {
  name: string;
  fileMetadataId: Id<'fileMetadata'>;
  storageId: Id<'_storage'>;
  size: number;
  contentType: string;
}

interface CanvasRunnableCodeRendererProps {
  artifactId: Id<'artifacts'>;
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
  const { data: fileUrl } = useFileUrl(file.storageId);
  const Icon = iconForContentType(file.contentType);
  const disabled = !fileUrl;
  return (
    <a
      href={fileUrl ?? '#'}
      download={file.name}
      target={fileUrl ? '_blank' : undefined}
      rel="noreferrer"
      onClick={(e) => {
        if (disabled) e.preventDefault();
      }}
      className={cn(
        'border-border bg-background hover:bg-muted/40 flex items-center gap-2 rounded-md border px-3 py-2 text-sm transition-colors',
        disabled && 'opacity-60',
      )}
    >
      <Icon className="text-muted-foreground size-4 shrink-0" />
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="truncate font-medium">{file.name}</span>
        <span className="text-muted-foreground text-xs">
          {formatFileSize(file.size)}
        </span>
      </div>
      <Download className="text-muted-foreground size-3.5 shrink-0" />
    </a>
  );
}

function StatusBadge({
  runStatus,
  runProgress,
}: {
  runStatus?: string;
  runProgress?: string;
}) {
  const { t } = useT('chat');
  if (!runStatus) return null;
  if (runStatus === 'completed') {
    return (
      <Badge
        variant="outline"
        icon={CheckCircle2}
        className="text-success border-success/40"
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
      >
        {runStatus}
      </Badge>
    );
  }
  // queued / installing / running — live progress with spinner
  return (
    <Badge
      variant="outline"
      icon={(props) => (
        <Loader2 {...props} className={cn(props.className, 'animate-spin')} />
      )}
      className="border-border"
      role="status"
      aria-live="polite"
    >
      {runProgress ?? runStatus}
    </Badge>
  );
}

function CanvasRunnableCodeRendererComponent({
  artifactId,
  source,
  language,
  isStreaming,
}: CanvasRunnableCodeRendererProps) {
  const artifact = useQuery(api.artifacts.queries.getById, { artifactId });
  const runStatus = artifact?.runStatus;
  const runProgress = artifact?.runProgress;
  const runErrorCode = artifact?.runErrorCode;
  const runErrorMessage = artifact?.runErrorMessage;
  const stdoutPreview = artifact?.runStdoutPreview;
  const stderrPreview = artifact?.runStderrPreview;
  const outputFiles: RunOutputFile[] = (artifact?.runOutputFiles ??
    []) as RunOutputFile[];

  // Hide the execution panel entirely while there's nothing to show — i.e.
  // during source streaming (artifact_create still authoring) and after
  // artifact_create settles but before artifact_run has been invoked. The
  // bare "Run" header with no body felt empty / confusing in user testing.
  // Once artifact_run kicks off (runStatus !== undefined) or any prior-run
  // artefact (files / stderr / errorCode) is present, the panel re-appears.
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
              Run
            </span>
            <StatusBadge runStatus={runStatus} runProgress={runProgress} />
          </div>

          {runErrorCode && (
            <div className="border-destructive/30 bg-destructive/5 text-destructive rounded-md border p-2 text-xs">
              <div className="font-semibold">{runErrorCode}</div>
              {runErrorMessage && (
                <div className="mt-1 break-words">{runErrorMessage}</div>
              )}
            </div>
          )}

          {outputFiles.length > 0 && (
            <div className="flex flex-col gap-2">
              <span className="text-muted-foreground text-xs font-medium">
                Files
              </span>
              {outputFiles.map((f) => (
                <FileChip key={String(f.fileMetadataId)} file={f} />
              ))}
            </div>
          )}

          {stdoutPreview && stdoutPreview.length > 0 && (
            <details className="text-xs">
              <summary className="text-muted-foreground cursor-pointer font-medium">
                stdout ({stdoutPreview.length} chars)
              </summary>
              <pre className="bg-muted/40 mt-1 max-h-40 overflow-auto rounded p-2 font-mono whitespace-pre-wrap">
                {stdoutPreview}
              </pre>
            </details>
          )}

          {stderrPreview && stderrPreview.length > 0 && (
            <details className="text-xs" open={runStatus === 'failed'}>
              <summary className="text-muted-foreground cursor-pointer font-medium">
                stderr ({stderrPreview.length} chars)
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

export const CanvasRunnableCodeRenderer = memo(
  CanvasRunnableCodeRendererComponent,
);
