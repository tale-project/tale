'use client';

import { memo, useMemo } from 'react';

import { formatFileSize } from '@/lib/utils/format/file';

import { useCanvasPreferences } from '../hooks/canvas-preferences';
import {
  CopyAction,
  DownloadTextAction,
  WrapAction,
} from './canvas-file-actions';
import { CanvasViewerFrame } from './canvas-viewer-frame';
import { CodeViewer } from './code-viewer';

interface CodeFileViewerProps {
  path: string;
  content: string;
}

/**
 * Canvas viewer for plain code/text files: the syntax-highlighted `CodeViewer`
 * plus the shared floating action card (wrap / copy / download / size). Replaces
 * the old `<CodeViewer showWrapToggle />` top strip so code files present the
 * same control surface as every other canvas variant.
 */
function CodeFileViewerComponent({ path, content }: CodeFileViewerProps) {
  const { wrap, toggleWrap } = useCanvasPreferences();
  const sizeLabel = useMemo(
    () => formatFileSize(new TextEncoder().encode(content).length),
    [content],
  );

  return (
    <CanvasViewerFrame
      sizeLabel={sizeLabel}
      actions={
        <>
          <WrapAction wrap={wrap} onToggle={toggleWrap} />
          <CopyAction content={content} />
          <DownloadTextAction path={path} content={content} />
        </>
      }
    >
      <CodeViewer path={path} content={content} wrap={wrap} />
    </CanvasViewerFrame>
  );
}

export const CodeFileViewer = memo(CodeFileViewerComponent);
