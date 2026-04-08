'use client';

import { memo } from 'react';

import { cn } from '@/lib/utils/cn';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '../message-bubble/markdown-renderer';
import { TypewriterText } from '../typewriter-text';

interface CanvasMarkdownRendererProps {
  content: string;
  isEditing: boolean;
  onContentChange: (content: string) => void;
}

function CanvasMarkdownRendererComponent({
  content,
  isEditing,
  onContentChange,
}: CanvasMarkdownRendererProps) {
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
        aria-label="Markdown editor"
      />
    );
  }

  return (
    <div className="h-full overflow-auto p-4">
      <div className={cn('text-sm', markdownWrapperStyles)}>
        <TypewriterText
          text={content}
          isStreaming={false}
          components={markdownComponents}
        />
      </div>
    </div>
  );
}

export const CanvasMarkdownRenderer = memo(CanvasMarkdownRendererComponent);
