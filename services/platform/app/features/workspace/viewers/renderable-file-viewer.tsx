'use client';

import { Button } from '@tale/ui/button';
import { Code, Eye } from 'lucide-react';
import { memo, useEffect, useState } from 'react';

import { useT } from '@/lib/i18n/client';

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
   */
  isStreaming: boolean;
}

/**
 * Owns the Source/Preview toggle for file kinds that have a "rendered"
 * presentation (html/svg/mermaid/markdown). Default is always Source — the
 * user opts into Preview manually. While streaming, Preview is disabled and
 * the source view is forced to keep the stream flicker-free.
 */
function RenderableFileViewerComponent({
  kind,
  path,
  content,
  isStreaming,
}: RenderableFileViewerProps) {
  const { t } = useT('chat');
  const [viewMode, setViewMode] = useState<'source' | 'preview'>('source');

  useEffect(() => {
    setViewMode('source');
  }, [path]);

  const effectiveMode: 'source' | 'preview' = isStreaming ? 'source' : viewMode;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="border-border bg-muted/30 flex shrink-0 items-center justify-end gap-1 border-b px-2 py-1"
        role="group"
        aria-label={t('canvas.viewToggleAriaLabel', {
          defaultValue: 'Toggle source / preview',
        })}
      >
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
      <div className="min-h-0 flex-1 overflow-hidden">
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
    </div>
  );
}

export const RenderableFileViewer = memo(RenderableFileViewerComponent);
