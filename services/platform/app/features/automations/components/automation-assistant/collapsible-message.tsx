'use client';

import { ChevronDown, ChevronUp, Bot } from 'lucide-react';
import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import { cn } from '@/lib/utils/cn';

const USER_MESSAGE_TRUNCATE_LENGTH = 120;
const ASSISTANT_MESSAGE_TRUNCATE_LENGTH = 250;

interface CollapsibleMessageProps {
  content: string;
  role: 'user' | 'assistant';
  isMarkdown?: boolean;
  viewMoreLabel: string;
  viewLessLabel: string;
  isLastMessage?: boolean;
}

export function CollapsibleMessage({
  content,
  role,
  isMarkdown = false,
  viewMoreLabel,
  viewLessLabel,
  isLastMessage = false,
}: CollapsibleMessageProps) {
  const [isExpanded, setIsExpanded] = useState(isLastMessage);
  const truncateLength =
    role === 'user'
      ? USER_MESSAGE_TRUNCATE_LENGTH
      : ASSISTANT_MESSAGE_TRUNCATE_LENGTH;
  const shouldTruncate = content.length > truncateLength;

  useEffect(() => {
    if (isLastMessage) {
      setIsExpanded(true);
    }
  }, [isLastMessage]);
  const displayContent =
    shouldTruncate && !isExpanded
      ? content.slice(0, truncateLength) + '...'
      : content;

  return (
    <div className="flex flex-col gap-1">
      {isMarkdown ? (
        <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-[10px] prose-headings:my-1 prose-headings:text-xs [&_code]:bg-muted-foreground/10 [&_code]:text-muted-foreground max-w-none text-xs [&_code]:inline-block [&_code]:max-w-full [&_code]:rounded-md [&_code]:px-1 [&_code]:py-0.5 [&_code]:font-mono [&_code]:text-[10px] [&_code]:break-words [&_code]:whitespace-normal [&_h3]:mt-1 [&_h3]:text-xs [&_li]:mb-0.5 [&_ol]:mt-0.5 [&_ol]:mb-0.5 [&_ol]:list-decimal [&_ol]:pl-3 [&_p]:mt-0.5 [&_p]:mb-0.5 [&_p]:leading-relaxed [&_p]:break-words [&_pre_code]:block [&_pre_code]:overflow-auto [&_pre_code]:break-normal [&_pre_code]:whitespace-pre [&_ul]:my-1 [&_ul]:list-disc [&_ul]:pl-3">
          <Bot className="text-muted-foreground mb-1.5 size-3.5" />
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {displayContent}
          </ReactMarkdown>
        </div>
      ) : (
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          {displayContent}
        </p>
      )}
      {shouldTruncate && (
        <button
          type="button"
          onClick={() => setIsExpanded(!isExpanded)}
          className={cn(
            'text-[10px] font-medium flex items-center gap-0.5 self-start transition-colors ml-auto',
            role === 'user'
              ? 'text-primary-foreground/70 hover:text-primary-foreground'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          {isExpanded ? (
            <>
              {viewLessLabel}
              <ChevronUp className="size-3" />
            </>
          ) : (
            <>
              {viewMoreLabel}
              <ChevronDown className="size-3" />
            </>
          )}
        </button>
      )}
    </div>
  );
}
