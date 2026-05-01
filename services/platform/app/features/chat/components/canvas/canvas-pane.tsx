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
  const { isCanvasOpen, artifactId, editBuffer, closeCanvas, setEditBuffer } =
    useCanvas();

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
    }
  }, [isCanvasOpen]);

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
  const previewContent =
    isStreaming && streamingContent !== undefined
      ? streamingContent
      : settledContent;
  const editorContent = editBuffer ?? settledContent;
  const displayedContent = isEditing ? editorContent : previewContent;
  const canvasType: CanvasContentType = artifact?.type ?? 'code';
  const canvasTitle = artifact?.title ?? '';
  const canvasLanguage = artifact?.language;

  // While the AI is mid-stream of a create/rewrite, half-emitted HTML
  // renders as a blank or broken iframe. Show the source code instead;
  // the preview takes over once `liveStreamMode` clears. Patch mode is
  // safe — patches apply atomically when execute returns, so the
  // previously-settled content stays valid in the iframe.
  const showStreamingSource =
    !isEditing && (liveStreamMode === 'create' || liveStreamMode === 'rewrite');
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
            ? `bg-background/95 border-border absolute top-0 right-0 left-0 z-30 flex items-center justify-between border-b p-3 backdrop-blur transition-transform duration-200 ${
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

      <div className="min-h-0 flex-1 overflow-hidden">
        {showStreamingSource && (
          <CanvasCodeRenderer
            code={displayedContent}
            language={streamingHighlightLang}
            isEditing={false}
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
