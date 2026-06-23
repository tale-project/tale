'use client';

import { Button } from '@tale/ui/button';
import { Code, Eye } from 'lucide-react';
import { memo, useMemo, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { formatFileSize } from '@/lib/utils/format/file';

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
  // Remember the chosen mode per file path. The canvas keeps a single
  // RenderableFileViewer mounted and only swaps `path` when you switch tabs;
  // resetting to `defaultMode` on every swap flipped source⇄preview and shifted
  // the layout. Keying by path makes the mode sticky per file, so re-selecting a
  // tab restores exactly what you last viewed — no jump.
  const [modeByPath, setModeByPath] = useState<
    Record<string, 'source' | 'preview'>
  >({});
  const viewMode = modeByPath[path] ?? defaultMode;
  const setViewMode = (mode: 'source' | 'preview') =>
    setModeByPath((prev) => ({ ...prev, [path]: mode }));

  const effectiveMode: 'source' | 'preview' = isStreaming ? 'source' : viewMode;

  // Byte size of the displayed content. UTF-8 length matches what's rendered
  // and grows live during a streaming `file_write`.
  const sizeLabel = useMemo(
    () => formatFileSize(new TextEncoder().encode(content).length),
    [content],
  );

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      {/* `pb-14` reserves a gutter the height of the floating control so the
          last line of content can scroll clear of it instead of hiding behind
          it. */}
      <div className="min-h-0 flex-1 overflow-hidden pb-14">
        {effectiveMode === 'source' ? (
          <CodeViewer path={path} content={content} />
        ) : kind === 'html' ? (
          <HtmlViewer html={content} />
        ) : kind === 'svg' ? (
          <SvgViewer svg={content} />
        ) : kind === 'mermaid' ? (
          <MermaidViewer code={content} />
        ) : (
          <MarkdownViewer content={content} />
        )}
      </div>

      {/* Floating control: the Source/Preview toggle plus the file size, docked
          bottom-right above the content as a raised card rather than a
          full-width top bar. */}
      <div
        className="border-border bg-background/95 absolute right-3 bottom-3 z-10 flex items-center gap-1 rounded-lg border p-1 shadow-md backdrop-blur"
        role="group"
        aria-label={t('canvas.viewToggleAriaLabel', {
          defaultValue: 'Toggle source / preview',
        })}
      >
        <span
          className="text-muted-foreground px-2 text-xs tabular-nums"
          aria-label={t('canvas.fileSizeAriaLabel', {
            defaultValue: 'File size',
          })}
        >
          {sizeLabel}
        </span>
        <Button
          variant={effectiveMode === 'source' ? 'secondary' : 'ghost'}
          size="sm"
          icon={Code}
          onClick={() => setViewMode('source')}
          aria-pressed={effectiveMode === 'source'}
        >
          {t('canvas.viewSource', { defaultValue: 'Source' })}
        </Button>
        <Button
          variant={effectiveMode === 'preview' ? 'secondary' : 'ghost'}
          size="sm"
          icon={Eye}
          onClick={() => setViewMode('preview')}
          aria-pressed={effectiveMode === 'preview'}
          disabled={isStreaming}
        >
          {t('canvas.viewPreview', { defaultValue: 'Preview' })}
        </Button>
      </div>
    </div>
  );
}

export const RenderableFileViewer = memo(RenderableFileViewerComponent);
