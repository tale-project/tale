'use client';

import {
  X,
  Copy,
  Check,
  Download,
  Pencil,
  Eye,
  Code,
  FileCode,
  FileText,
  Globe,
  GitBranch,
  Image,
} from 'lucide-react';
import { useState, useCallback, useRef, useEffect, memo } from 'react';

import { Badge } from '@/app/components/ui/feedback/badge';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
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

function CanvasPaneComponent() {
  const { t } = useT('chat');
  const {
    isCanvasOpen,
    canvasContent,
    canvasType,
    canvasTitle,
    canvasLanguage,
    isDirty,
    closeCanvas,
    updateCanvasContent,
    applyCanvasContent,
  } = useCanvas();

  const [isEditing, setIsEditing] = useState(false);
  const [viewMode, setViewMode] = useState<'render' | 'code'>('render');
  const [isCopied, setIsCopied] = useState(false);
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
      setViewMode('render');
    }
  }, [isCanvasOpen]);

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

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(canvasContent);
      setIsCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch {
      // Clipboard write failed
    }
  }, [canvasContent]);

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
    const blob = new Blob([canvasContent], { type: mimeTypes[canvasType] });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${canvasTitle || 'canvas'}.${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }, [canvasContent, canvasType, canvasTitle, canvasLanguage]);

  const toggleEdit = useCallback(() => {
    setIsEditing((prev) => !prev);
  }, []);

  const toggleViewMode = useCallback(() => {
    setViewMode((prev) => (prev === 'render' ? 'code' : 'render'));
  }, []);

  if (!isCanvasOpen) return null;

  const TypeIcon = TYPE_ICONS[canvasType];
  const canEdit =
    canvasType === 'code' ||
    canvasType === 'markdown' ||
    ((canvasType === 'html' || canvasType === 'svg') && viewMode === 'code');
  const hasRenderView =
    canvasType === 'html' || canvasType === 'markdown' || canvasType === 'svg';

  return (
    <div
      className="border-border relative flex h-full shrink-0 flex-col border-l"
      style={{ width }}
    >
      <div
        ref={resizeRef}
        onMouseDown={handleMouseDown}
        className="absolute top-0 -left-1 z-10 h-full w-2 cursor-col-resize"
        role="separator"
        aria-orientation="vertical"
        aria-label={t('canvas.resizeHandle')}
      />

      <div className="border-border flex items-center justify-between border-b p-3">
        <div className="flex min-w-0 items-center gap-2">
          <TypeIcon className="text-muted-foreground size-4 shrink-0" />
          <span className="truncate text-sm font-medium">{canvasTitle}</span>
          <Badge variant="outline" className="shrink-0 text-xs">
            {TYPE_LABELS[canvasType]}
          </Badge>
        </div>

        <div className="flex items-center gap-1">
          {hasRenderView && (
            <Tooltip
              content={
                viewMode === 'render'
                  ? t('canvas.viewCode')
                  : t('canvas.viewRender')
              }
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={toggleViewMode}
                aria-label={
                  viewMode === 'render'
                    ? t('canvas.viewCode')
                    : t('canvas.viewRender')
                }
              >
                {viewMode === 'render' ? (
                  <FileCode className="size-3.5" />
                ) : (
                  <Eye className="size-3.5" />
                )}
              </Button>
            </Tooltip>
          )}

          {canEdit && (
            <Tooltip
              content={isEditing ? t('canvas.preview') : t('canvas.edit')}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={toggleEdit}
                aria-label={isEditing ? t('canvas.preview') : t('canvas.edit')}
              >
                {isEditing ? (
                  <Eye className="size-3.5" />
                ) : (
                  <Pencil className="size-3.5" />
                )}
              </Button>
            </Tooltip>
          )}

          {canEdit && isDirty && (
            <Tooltip content={t('canvas.applyTooltip')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="size-7"
                onClick={applyCanvasContent}
                aria-label={t('canvas.apply')}
              >
                <Check className="text-success size-3.5" />
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
        {canvasType === 'code' && (
          <CanvasCodeRenderer
            code={canvasContent}
            language={canvasLanguage}
            isEditing={isEditing}
            onContentChange={updateCanvasContent}
          />
        )}
        {canvasType === 'html' &&
          (viewMode === 'code' ? (
            <CanvasCodeRenderer
              code={canvasContent}
              language="html"
              isEditing={isEditing}
              onContentChange={updateCanvasContent}
            />
          ) : (
            <CanvasHtmlRenderer html={canvasContent} />
          ))}
        {canvasType === 'svg' &&
          (viewMode === 'code' ? (
            <CanvasCodeRenderer
              code={canvasContent}
              language="svg"
              isEditing={isEditing}
              onContentChange={updateCanvasContent}
            />
          ) : (
            <CanvasHtmlRenderer html={canvasContent} />
          ))}
        {canvasType === 'mermaid' && (
          <CanvasMermaidRenderer code={canvasContent} />
        )}
        {canvasType === 'markdown' &&
          (viewMode === 'code' ? (
            <CanvasCodeRenderer
              code={canvasContent}
              language="markdown"
              isEditing={isEditing}
              onContentChange={updateCanvasContent}
            />
          ) : (
            <CanvasMarkdownRenderer
              content={canvasContent}
              isEditing={isEditing}
              onContentChange={updateCanvasContent}
            />
          ))}
      </div>
    </div>
  );
}

export const CanvasPane = memo(CanvasPaneComponent);
