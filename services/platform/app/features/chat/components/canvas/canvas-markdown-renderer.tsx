'use client';

import { forwardRef, memo, useImperativeHandle, useRef } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';

export interface CanvasMarkdownRendererHandle {
  // Returns the live rendered HTML of the article (the same DOM the user is
  // looking at). Used by the PDF export path so the printed document is
  // pixel-parity with the on-screen rendering — re-running react-markdown
  // could drift if components/plugins change.
  getRenderedHtml: () => string | null;
}

interface CanvasMarkdownRendererProps {
  content: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function CanvasMarkdownRendererComponent(
  { content, isEditing, onContentChange }: CanvasMarkdownRendererProps,
  ref: React.Ref<CanvasMarkdownRendererHandle>,
) {
  const { t } = useT('chat');
  const articleRef = useRef<HTMLDivElement>(null);

  useImperativeHandle(
    ref,
    () => ({
      getRenderedHtml: () => articleRef.current?.innerHTML ?? null,
    }),
    [],
  );

  if (isEditing) {
    return (
      <textarea
        value={content}
        onChange={(e) => onContentChange(e.target.value)}
        className={cn(
          'bg-muted text-foreground h-full w-full resize-none p-4 font-mono text-sm leading-relaxed',
          'focus:outline-none',
        )}
        spellCheck={false}
        aria-label={t('canvas.markdownEditor')}
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div ref={articleRef} className={cn('text-sm', markdownWrapperStyles)}>
        <TypewriterText
          text={content}
          isStreaming={false}
          components={markdownComponents}
        />
      </div>
    </div>
  );
}

export const CanvasMarkdownRenderer = memo(
  forwardRef(CanvasMarkdownRendererComponent),
);
