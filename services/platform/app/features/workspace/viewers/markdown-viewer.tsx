'use client';

import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import {
  markdownComponents,
  markdownWrapperStyles,
} from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { cn } from '@/lib/utils/cn';

interface MarkdownViewerProps {
  content: string;
}

function MarkdownViewerComponent({ content }: MarkdownViewerProps) {
  return (
    <div className="h-full overflow-auto p-4">
      <div className={cn('text-sm', markdownWrapperStyles)}>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {content}
        </ReactMarkdown>
      </div>
    </div>
  );
}

export const MarkdownViewer = memo(MarkdownViewerComponent);
