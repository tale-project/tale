'use client';

import { Info } from 'lucide-react';
import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { markdownWrapperStyles } from '@/app/features/shared/markdown/markdown-renderer';
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
          'border-border max-w-none min-w-0 border-t px-3 py-2 text-xs leading-relaxed',
          // Never let content force a horizontal scrollbar on the panel: wrap
          // normal prose, and break long inline-code tokens (URLs, callback
          // paths, BASE_PATH) at any point rather than overflowing.
          'break-words [&_code]:[overflow-wrap:anywhere] [&_code]:break-words',
        )}
      >
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ href, children, ...rest }) => (
              <a
                href={href}
                target="_blank"
                rel="noopener noreferrer"
                {...rest}
              >
                {children}
              </a>
            ),
            pre: ({ node: _node, className, children, ...rest }) => (
              <pre
                {...rest}
                className={cn(
                  'bg-muted/60 border-border my-2 overflow-x-auto rounded-md border p-3 font-mono text-[11px] leading-relaxed',
                  // Wrap long lines instead of overflowing the panel; whitespace
                  // is still preserved (pre-wrap), unbreakable tokens break.
                  '[overflow-wrap:anywhere] break-words whitespace-pre-wrap',
                  className,
                )}
              >
                {children}
              </pre>
            ),
          }}
        >
          {content}
        </ReactMarkdown>
      </div>
    </details>
  );
}
