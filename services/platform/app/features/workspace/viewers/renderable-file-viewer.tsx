'use client';

import { Button } from '@tale/ui/button';
import { Code, Eye } from 'lucide-react';
import { memo, useMemo } from 'react';

import { useT } from '@/lib/i18n/client';
import { formatFileSize } from '@/lib/utils/format/file';

import { useCanvasPreferences } from '../hooks/canvas-preferences';
import {
  CopyAction,
  DownloadTextAction,
  WrapAction,
} from './canvas-file-actions';
import { CanvasViewerFrame } from './canvas-viewer-frame';
import { CodeViewer } from './code-viewer';
import { HtmlViewer } from './html-viewer';
import { MarkdownViewer } from './markdown-viewer';
import { MermaidViewer } from './mermaid-viewer';
import { SvgViewer } from './svg-viewer';

export type RenderableKind = 'html' | 'svg' | 'mermaid' | 'markdown';

interface RenderableFileViewerProps {
  kind: RenderableKind;
  path: string;
  content: string;
  /**
   * `true` while a `file_write` tool call is actively streaming bytes into
   * this path. While streaming, we force the source view (via CodeViewer's
   * debounced shiki path) so the user sees a smooth, syntax-highlighted
   * stream instead of the rendered viewer flickering on every delta.
   * Defaults to `false` for static contexts (e.g. the workspace file explorer).
   */
  isStreaming?: boolean;
  /**
   * Which view to show initially (and to reset to on `path` change). The
   * streaming canvas wants `source` (watch the bytes arrive); a static reader
   * like the workspace file explorer passes `preview` so a Markdown file opens
   * rendered/user-friendly. Defaults to `source`.
   */
  defaultMode?: 'source' | 'preview';
}

/**
 * Owns the Source/Preview toggle for file kinds that have a "rendered"
 * presentation (html/svg/mermaid/markdown). While streaming, Preview is
 * disabled and the source view is forced to keep the stream flicker-free.
 */
function RenderableFileViewerComponent({
  kind,
  path,
  content,
  isStreaming = false,
  defaultMode = 'source',
}: RenderableFileViewerProps) {
  const { t } = useT('chat');
  // Wrap + the per-file Source/Preview choice live in the shared canvas
  // preferences so they hold as you move between files and viewer kinds (a
  // re-selected tab restores exactly what you last viewed — no jump).
  const { wrap, toggleWrap, getViewMode, setViewMode } = useCanvasPreferences();
  const viewMode = getViewMode(path, defaultMode);

  const effectiveMode: 'source' | 'preview' = isStreaming ? 'source' : viewMode;

  // Byte size of the displayed content. UTF-8 length matches what's rendered
  // and grows live during a streaming `file_write`.
  const sizeLabel = useMemo(
    () => formatFileSize(new TextEncoder().encode(content).length),
    [content],
  );

  return (
    <CanvasViewerFrame
      sizeLabel={sizeLabel}
      actions={
        <>
          {/* Wrapping only applies to the source view (the rendered preview has
              no long-line concept). */}
          {effectiveMode === 'source' && (
            <WrapAction wrap={wrap} onToggle={toggleWrap} />
          )}
          <CopyAction content={content} />
          <DownloadTextAction path={path} content={content} />
          <Button
            variant={effectiveMode === 'source' ? 'secondary' : 'ghost'}
            size="sm"
            icon={Code}
            onClick={() => setViewMode(path, 'source')}
            aria-pressed={effectiveMode === 'source'}
          >
            {t('canvas.viewSource', { defaultValue: 'Source' })}
          </Button>
          <Button
            variant={effectiveMode === 'preview' ? 'secondary' : 'ghost'}
            size="sm"
            icon={Eye}
            onClick={() => setViewMode(path, 'preview')}
            aria-pressed={effectiveMode === 'preview'}
            disabled={isStreaming}
          >
            {t('canvas.viewPreview', { defaultValue: 'Preview' })}
          </Button>
        </>
      }
    >
      {effectiveMode === 'source' ? (
        <CodeViewer path={path} content={content} wrap={wrap} />
      ) : kind === 'html' ? (
        <HtmlViewer html={content} />
      ) : kind === 'svg' ? (
        <SvgViewer svg={content} />
      ) : kind === 'mermaid' ? (
        <MermaidViewer code={content} />
      ) : (
        <MarkdownViewer content={content} />
      )}
    </CanvasViewerFrame>
  );
}

export const RenderableFileViewer = memo(RenderableFileViewerComponent);
