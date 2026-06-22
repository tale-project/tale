'use client';

import { memo } from 'react';

import { MarkdownContent } from '@/app/features/chat/components/message-bubble/markdown-renderer';

interface MarkdownViewerProps {
  content: string;
}

function MarkdownViewerComponent({ content }: MarkdownViewerProps) {
  return (
    <div className="h-full overflow-auto p-4">
      <MarkdownContent content={content} />
    </div>
  );
}

export const MarkdownViewer = memo(MarkdownViewerComponent);
