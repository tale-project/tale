'use client';

import { useMutation, useQuery } from 'convex/react';
import {
  Check,
  Code,
  Copy,
  Download,
  Eye,
  FileText,
  GitBranch,
  Globe,
  Image,
  Loader2,
  Maximize2,
  Minimize2,
  Pencil,
  Save,
  X,
} from 'lucide-react';
import { memo, useCallback, useEffect, useRef, useState } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useToast } from '@/app/hooks/use-toast';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { lazyComponent } from '@/lib/utils/lazy-component';

import { useCanvas, type CanvasContentType } from './canvas-context';

const CanvasCodeRenderer = lazyComponent(() =>
  import('./canvas-code-renderer').then((m) => ({
    default: m.CanvasCodeRenderer,
  })),
);

const CanvasHtmlRenderer = lazyComponent(() =>
  import('./canvas-html-renderer').then((m) => ({
    default: m.CanvasHtmlRenderer,
  })),
);

const CanvasMermaidRenderer = lazyComponent(() =>
  import('./canvas-mermaid-renderer').then((m) => ({
    default: m.CanvasMermaidRenderer,
  })),
);

const CanvasMarkdownRenderer = lazyComponent(() =>
  import('./canvas-markdown-renderer').then((m) => ({
    default: m.CanvasMarkdownRenderer,
  })),
);

const TYPE_ICONS: Record<CanvasContentType, typeof Code> = {
  code: Code,
  html: Globe,
  mermaid: GitBranch,
  svg: Image,
  markdown: FileText,
};

const TYPE_LABELS: Record<CanvasContentType, string> = {
  code: 'Code',
  html: 'HTML',
  mermaid: 'Mermaid',
  svg: 'SVG',
  markdown: 'Markdown',
};

const MIN_WIDTH = 320;
const MAX_WIDTH = 900;
const DEFAULT_WIDTH = 480;
/** Minimum total time the source view stays up across a stream + post-stream
 * dwell. A fast patch (sub-second emit) would otherwise flick into source
 * view, show a diff for a heartbeat, then yank back to preview before the
 * user can read anything. This ensures the user has a chance to read the
 * diff regardless of how quick the model is. */
const MIN_SOURCE_VIEW_MS = 10_000;

// Wrapper so the spinning Loader2 can be passed to Badge's `icon` slot,
// which renders it inline with the label instead of nesting it inside
// the children span (where it would stack above the text).
function SpinnerIcon({ className }: { className?: string }) {
  return (
    <Loader2 className={cn(className, 'animate-spin')} aria-hidden="true" />
  );
}

function CanvasPaneComponent() {
  const { t } = useT('chat');
  const { toast } = useToast();
  const { isCanvasOpen, artifactId, closeCanvas } = useCanvas();
  // Edit buffer lives in local state — only this component reads / writes it.
  // Keeping it in CanvasContext used to fan out a per-keystroke render to
  // every `useCanvas()` consumer (ArtifactBar, MessageArtifactPills,
  // PlanPane), which dominated the cost of editing a 200 KB artifact.
  const [editBuffer, setEditBuffer] = useState<string | undefined>(undefined);

  const artifact = useQuery(
    api.artifacts.queries.getById,
    artifactId ? { artifactId } : 'skip',
  );
  const userEditMutation = useMutation(api.artifacts.mutations.userEdit);

  const [isEditing, setIsEditing] = useState(false);
  const [isCopied, setIsCopied] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [isHeaderVisible, setIsHeaderVisible] = useState(true);
  const [isApplying, setIsApplying] = useState(false);
  const [justSettled, setJustSettled] = useState(false);
  const [keepSourceLock, setKeepSourceLock] = useState(false);
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const resizeRef = useRef<HTMLDivElement>(null);
  const isDraggingRef = useRef(false);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!isCanvasOpen) {
      setIsEditing(false);
      setIsFullscreen(false);
      setEditBuffer(undefined);
    }
  }, [isCanvasOpen]);

  // Reset edit-in-progress state when the user switches to a different
  // artifact so previous typing doesn't leak across.
  const prevEditArtifactRef = useRef(artifactId);
  useEffect(() => {
    if (prevEditArtifactRef.current !== artifactId) {
      prevEditArtifactRef.current = artifactId;
      setIsEditing(false);
      setEditBuffer(undefined);
    }
  }, [artifactId]);

  // Pulse the content area when an AI stream finishes settling. Patch in
  // particular is an instant transition (content was unchanged during the
  // stream, then changed at execute), so a brief visual signal tells the
  // user "something just landed" — without trying to surface what changed
  // at the range level (which would need renderer-specific overlays).
  const prevLiveStreamModeRef =
    useRef<NonNullable<typeof artifact>['liveStreamMode']>(undefined);
  // Track the artifact id alongside liveStreamMode so a switch from one
  // artifact to another doesn't fire a spurious settle pulse / release the
  // lock as if the previous artifact's stream had ended.
  const prevArtifactIdRef = useRef<string | undefined>(artifactId);
  // Stream start anchor + frozen pre-settle snapshot. The snapshot lets us
  // keep the diff visible after the server clears `streamingPatches` — see
  // the "10s minimum dwell" block below.
  const streamStartedAtRef = useRef<number | null>(null);
  const lastPatchSnapshotRef = useRef<{
    code: string;
    patches: readonly { search: string; replace: string }[];
  } | null>(null);
  useEffect(() => {
    const prevId = prevArtifactIdRef.current;
    prevArtifactIdRef.current = artifactId;
    if (prevId !== artifactId) {
      // Artifact swapped under us. Reset stream-tracking state so the new
      // artifact is observed from a clean slate; otherwise a transition
      // from "old artifact streaming" to "new artifact static" would look
      // like a settle event on the new artifact.
      prevLiveStreamModeRef.current = artifact?.liveStreamMode;
      streamStartedAtRef.current = null;
      lastPatchSnapshotRef.current = null;
      setKeepSourceLock(false);
      setJustSettled(false);
      return undefined;
    }

    const prev = prevLiveStreamModeRef.current;
    const next = artifact?.liveStreamMode;
    prevLiveStreamModeRef.current = next;
    if (prev === undefined && next !== undefined) {
      // Stream just started — anchor the dwell timer. Only patch streams
      // engage the dwell lock: create / rewrite have already been streaming
      // their content into source view for the user to read, so an extra
      // pad would just delay the natural switch back to preview. Patch
      // alone needs the pad because its diff might land in a single
      // sub-second tool call.
      streamStartedAtRef.current = Date.now();
      lastPatchSnapshotRef.current = null;
      setKeepSourceLock(next === 'patch');
    }
    if (prev !== undefined && next === undefined && artifact) {
      setJustSettled(true);
      const id = setTimeout(() => setJustSettled(false), 1200);
      return () => clearTimeout(id);
    }
    return undefined;
  }, [artifact, artifactId]);

  // While a patch stream is alive, snapshot the (still pre-settle) source
  // and the latest emitted patches. Once the server clears
  // `streamingPatches` at execute time the live data evaporates, but the
  // snapshot lets the renderer keep showing the diff for the dwell window.
  useEffect(() => {
    if (
      artifact?.liveStreamMode === 'patch' &&
      artifact.streamingPatches &&
      artifact.streamingPatches.length > 0
    ) {
      lastPatchSnapshotRef.current = {
        code: artifact.content,
        patches: artifact.streamingPatches,
      };
    }
  }, [artifact?.liveStreamMode, artifact?.streamingPatches, artifact?.content]);

  // Release the source-view lock once the dwell window has passed. Anchored
  // at stream start so a 5s stream gets ~5s of additional viewing while a
  // 30s stream releases the lock immediately on settle.
  useEffect(() => {
    if (artifact?.liveStreamMode !== undefined) return undefined;
    if (!keepSourceLock) return undefined;
    const startedAt = streamStartedAtRef.current ?? Date.now();
    const elapsed = Date.now() - startedAt;
    const remaining = Math.max(0, MIN_SOURCE_VIEW_MS - elapsed);
    const id = setTimeout(() => {
      setKeepSourceLock(false);
      streamStartedAtRef.current = null;
      lastPatchSnapshotRef.current = null;
    }, remaining);
    return () => clearTimeout(id);
  }, [artifact?.liveStreamMode, keepSourceLock]);

  // Notify the user once when a stream starts on top of an open edit. The
  // edit buffer is preserved; they can keep typing or hit Cancel to discard.
  const streamingDuringEditNotifiedRef = useRef(false);
  useEffect(() => {
    const liveDuringEdit = isEditing && artifact?.liveStreamMode !== undefined;
    if (liveDuringEdit && !streamingDuringEditNotifiedRef.current) {
      streamingDuringEditNotifiedRef.current = true;
      toast({ title: t('canvas.streamingDuringEdit') });
    } else if (!liveDuringEdit) {
      streamingDuringEditNotifiedRef.current = false;
    }
  }, [isEditing, artifact?.liveStreamMode, toast, t]);

  useEffect(() => {
    setIsHeaderVisible(true);
  }, [isFullscreen]);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsFullscreen(false);
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isFullscreen]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isDraggingRef.current = true;
    const startX = e.clientX;
    const startWidth =
      resizeRef.current?.parentElement?.offsetWidth ?? DEFAULT_WIDTH;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      if (!isDraggingRef.current) return;
      const delta = startX - moveEvent.clientX;
      const newWidth = Math.min(
        MAX_WIDTH,
        Math.max(MIN_WIDTH, startWidth + delta),
      );
      setWidth(newWidth);
    };

    const handleMouseUp = () => {
      isDraggingRef.current = false;
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
  }, []);

  // Read content reactively. Streaming-aware: while the artifact is being
  // written by the LLM, prefer `streamingContent`; once settled, use `content`.
  const settledContent = artifact?.content ?? '';
  const streamingContent = artifact?.streamingContent;
  const isStreaming = artifact?.liveStreamMode !== undefined;
  const liveStreamMode = artifact?.liveStreamMode;
  // create/rewrite stream tokens into streamingContent; patch leaves the
  // source static. Only the former should drive the trailing caret in the
  // code renderer — a blinking caret on unchanging source is misleading.
  const isContentStreaming =
    liveStreamMode === 'create' || liveStreamMode === 'rewrite';
  const previewContent =
    isStreaming && streamingContent !== undefined
      ? streamingContent
      : settledContent;
  const editorContent = editBuffer ?? settledContent;
  const displayedContent = isEditing ? editorContent : previewContent;
  const canvasType: CanvasContentType = artifact?.type ?? 'code';
  const canvasTitle = artifact?.title ?? '';
  const canvasLanguage = artifact?.language;

  // While "AI is editing…" is on screen, the user expects a view that
  // matches that promise. We also keep the source view up for a minimum
  // dwell window after the stream ends (`keepSourceLock`) so a fast patch
  // does not flick through the diff faster than a human can read it. The
  // settle pulse + delayed return to preview handle the closing transition.
  const showStreamingSource = !isEditing && (isStreaming || keepSourceLock);
  // After the server clears `streamingPatches` at execute time we still
  // want the diff visible for the dwell window. Fall back to the snapshot
  // taken just before settle (frozen pre-patch source + final patches).
  const lockedSnapshot =
    !isStreaming && keepSourceLock ? lastPatchSnapshotRef.current : null;
  const sourceCode = lockedSnapshot ? lockedSnapshot.code : displayedContent;
  const sourcePatches:
    | readonly { search: string; replace: string }[]
    | undefined = lockedSnapshot
    ? lockedSnapshot.patches
    : liveStreamMode === 'patch'
      ? artifact?.streamingPatches
      : undefined;
  const streamingHighlightLang =
    canvasType === 'code' ? canvasLanguage : canvasType;

  const isDirty = editBuffer !== undefined && editBuffer !== settledContent;
  const canApply = isDirty && !!artifactId && !isStreaming;

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(displayedContent);
      setIsCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (err) {
      console.error('Failed to copy artifact:', err);
    }
  }, [displayedContent]);

  const handleDownload = useCallback(() => {
    const extensions: Record<CanvasContentType, string> = {
      code: canvasLanguage ?? 'txt',
      html: 'html',
      mermaid: 'mmd',
      svg: 'svg',
      markdown: 'md',
    };
    const ext = extensions[canvasType];
    const mimeTypes: Record<CanvasContentType, string> = {
      code: 'text/plain',
      html: 'text/html',
      mermaid: 'text/plain',
      svg: 'image/svg+xml',
      markdown: 'text/markdown',
    };
    const blob = new Blob([displayedContent], { type: mimeTypes[canvasType] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${canvasTitle || 'canvas'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [displayedContent, canvasType, canvasTitle, canvasLanguage]);

  const toggleEdit = useCallback(() => {
    setIsEditing((prev) => {
      const next = !prev;
      // Entering edit: seed buffer from current settled content if the user
      // hasn't typed anything yet. Exiting edit without applying: discard the
      // buffer so re-opening doesn't surface stale typing.
      if (next && editBuffer === undefined) setEditBuffer(settledContent);
      if (!next) setEditBuffer(undefined);
      return next;
    });
  }, [editBuffer, settledContent, setEditBuffer]);

  const toggleFullscreen = useCallback(() => {
    setIsFullscreen((prev) => !prev);
  }, []);

  const onContentChange = useCallback(
    (next: string) => {
      setEditBuffer(next);
    },
    [setEditBuffer],
  );

  const handleApply = useCallback(async () => {
    if (!artifactId || editBuffer === undefined) return;
    setIsApplying(true);
    try {
      await userEditMutation({ artifactId, content: editBuffer });
      setEditBuffer(undefined);
      setIsEditing(false);
      toast({ title: t('canvas.applied'), variant: 'success' });
    } catch (err) {
      console.error('Failed to apply canvas edit:', err);
      toast({ title: t('canvas.applyFailed'), variant: 'destructive' });
    } finally {
      setIsApplying(false);
    }
  }, [artifactId, editBuffer, userEditMutation, setEditBuffer, t, toast]);

  if (!isCanvasOpen || !artifactId) return null;

  const TypeIcon = TYPE_ICONS[canvasType];

  return (
    <div
      className={
        isFullscreen
          ? 'bg-background fixed inset-0 z-50 flex flex-col'
          : 'border-border relative flex h-full shrink-0 flex-col border-l'
      }
      style={isFullscreen ? undefined : { width }}
    >
      {!isFullscreen && (
        <div
          ref={resizeRef}
          onMouseDown={handleMouseDown}
          className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
          role="separator"
          aria-orientation="vertical"
          aria-label={t('canvas.resizeHandle')}
        />
      )}

      {isFullscreen && !isHeaderVisible && (
        <div
          className="absolute top-0 right-0 left-0 z-20 h-4"
          onMouseEnter={() => setIsHeaderVisible(true)}
          aria-hidden="true"
        />
      )}

      <div
        className={
          isFullscreen
            ? // No `backdrop-blur` here on purpose — it forces the compositor
              // to re-sample the streaming content beneath every frame, which
              // is one of the top paint costs at 100KB+ artifact size. The
              // `bg-background/95` is opaque enough that the blur was barely
              // visible anyway. See R2-05 in the perf review.
              `bg-background/95 border-border absolute top-0 right-0 left-0 z-30 flex items-center justify-between border-b p-3 transition-transform duration-200 ${
                isHeaderVisible ? 'translate-y-0' : '-translate-y-full'
              }`
            : 'border-border flex items-center justify-between border-b p-3'
        }
        onMouseLeave={
          isFullscreen ? () => setIsHeaderVisible(false) : undefined
        }
      >
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{canvasTitle}</span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {TYPE_LABELS[canvasType]}
          </Badge>
          {isStreaming && (
            <Badge
              variant="outline"
              icon={SpinnerIcon}
              className="shrink-0 text-xs"
              role="status"
              aria-live="polite"
            >
              {liveStreamMode === 'patch'
                ? t('canvas.streamingPatch')
                : t('canvas.streamingWriting')}
            </Badge>
          )}
        </div>

        <div className="flex items-center gap-1">
          <Tooltip
            content={isEditing ? t('canvas.cancel') : t('canvas.edit')}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleEdit}
              // Allow exiting edit at any time so a stream that starts mid-edit
              // does not trap the user; only block *entering* edit while a
              // stream is in flight (the underlying content is unstable).
              disabled={!isEditing && isStreaming}
              aria-label={isEditing ? t('canvas.cancel') : t('canvas.edit')}
            >
              {isEditing ? (
                <Eye className="size-3.5" />
              ) : (
                <Pencil className="size-3.5" />
              )}
            </Button>
          </Tooltip>

          {canApply && (
            <Tooltip content={t('canvas.apply')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={handleApply}
                disabled={isApplying}
                aria-label={t('canvas.apply')}
              >
                {isApplying ? (
                  <Loader2 className="size-3.5 animate-spin" />
                ) : (
                  <Save className="size-3.5" />
                )}
              </Button>
            </Tooltip>
          )}

          <Tooltip
            content={isCopied ? t('canvas.copied') : t('canvas.copy')}
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleCopy}
              aria-label={t('canvas.copy')}
            >
              {isCopied ? (
                <Check className="text-success size-3.5" />
              ) : (
                <Copy className="size-3.5" />
              )}
            </Button>
          </Tooltip>

          <Tooltip content={t('canvas.download')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={handleDownload}
              aria-label={t('canvas.download')}
            >
              <Download className="size-3.5" />
            </Button>
          </Tooltip>

          <Tooltip
            content={
              isFullscreen
                ? t('canvas.exitFullscreen')
                : t('canvas.enterFullscreen')
            }
            side="bottom"
          >
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={toggleFullscreen}
              aria-label={
                isFullscreen
                  ? t('canvas.exitFullscreen')
                  : t('canvas.enterFullscreen')
              }
            >
              {isFullscreen ? (
                <Minimize2 className="size-3.5" />
              ) : (
                <Maximize2 className="size-3.5" />
              )}
            </Button>
          </Tooltip>

          <Tooltip content={t('canvas.close')} side="bottom">
            <Button
              variant="ghost"
              size="icon"
              className="size-7"
              onClick={closeCanvas}
              aria-label={t('canvas.close')}
            >
              <X className="size-3.5" />
            </Button>
          </Tooltip>
        </div>
      </div>

      <div
        className={cn(
          'min-h-0 flex-1 overflow-hidden transition-shadow duration-700',
          justSettled && 'ring-success/40 ring-2 ring-inset',
        )}
      >
        {showStreamingSource && (
          <CanvasCodeRenderer
            code={sourceCode}
            language={streamingHighlightLang}
            isEditing={false}
            isStreaming={isContentStreaming}
            highlightPatches={sourcePatches}
            onContentChange={onContentChange}
          />
        )}
        {!showStreamingSource && canvasType === 'code' && (
          <CanvasCodeRenderer
            code={displayedContent}
            language={canvasLanguage}
            isEditing={isEditing}
            onContentChange={onContentChange}
          />
        )}
        {!showStreamingSource && canvasType === 'html' && (
          <CanvasHtmlRenderer
            html={displayedContent}
            isEditing={isEditing}
            onContentChange={onContentChange}
          />
        )}
        {!showStreamingSource && canvasType === 'svg' && (
          <CanvasHtmlRenderer
            html={displayedContent}
            isEditing={isEditing}
            onContentChange={onContentChange}
          />
        )}
        {!showStreamingSource && canvasType === 'mermaid' && (
          <CanvasMermaidRenderer
            code={displayedContent}
            isEditing={isEditing}
            onContentChange={onContentChange}
          />
        )}
        {!showStreamingSource && canvasType === 'markdown' && (
          <CanvasMarkdownRenderer
            content={displayedContent}
            isEditing={isEditing}
            onContentChange={onContentChange}
          />
        )}
      </div>
    </div>
  );
}

export const CanvasPane = memo(CanvasPaneComponent);
