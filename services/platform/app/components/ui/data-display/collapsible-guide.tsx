'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { markdownWrapperStyles } from '@/app/features/chat/components/message-bubble/markdown-renderer';
import { cn } from '@/lib/utils/cn';

interface CollapsibleGuideProps {
  label: string;
  content: string;
  defaultOpen?: boolean;
}

export function CollapsibleGuide({
  label,
  content,
  defaultOpen,
}: CollapsibleGuideProps) {
  const [isOpen, setIsOpen] = useState(Boolean(defaultOpen));

  return (
    <details
      className="bg-muted/30 border-border rounded-lg border"
      open={isOpen}
      onToggle={(event) => setIsOpen(event.currentTarget.open)}
    >
      <summary className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm font-medium">
        <Info className="text-muted-foreground size-3.5 shrink-0" />
        {label}
      </summary>
      <div
        className={cn(
          markdownWrapperStyles,
          'max-w-none border-t border-border px-3 py-2 text-xs leading-relaxed',
        )}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
      </div>
    </details>
  );
}
