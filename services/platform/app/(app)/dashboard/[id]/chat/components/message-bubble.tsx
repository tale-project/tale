'use client';

import { cn } from '@/lib/utils/cn';
import { ComponentPropsWithoutRef, useState, useMemo } from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { useTypewriter } from '../hooks/use-typewriter';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { sanitizeChatMessage } from '@/lib/utils/sanitize-chat';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Info } from 'lucide-react';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import { useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { Id } from '@/convex/_generated/dataModel';
import MessageInfoModal from './message-info-modal';
import { useMessageMetadata } from '../hooks/use-message-metadata';

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
}

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: FileAttachment[];
  threadId?: string;
}

const MarkdownWrapper = styled.div`
  /* Paragraphs */
  p:not(:last-child) {
    margin-bottom: 0.5rem;
  }

  /* Lists */
  ul {
    margin-bottom: 0.5rem;
    margin-top: 0.5rem;
    padding-left: 1rem;
    list-style-type: disc;
  }
  ol {
    margin-bottom: 0.5rem;
    margin-top: 0.5rem;
    padding-left: 1rem;
    list-style-type: decimal;
  }
  li {
    margin-bottom: 0.25rem;
  }

  /* Headings */
  h1,
  h2,
  h3,
  h4,
  h5,
  h6 {
    margin-bottom: 0.5rem;
    margin-top: 1rem;
    font-weight: 700;
  }
  h1 {
    font-size: 1.5rem;
  }
  h2 {
    font-size: 1.25rem;
  }
  h3 {
    font-size: 1.125rem;
  }

  /* Links */
  a {
    color: #0561e6;
    text-decoration: none;
    &:hover {
      text-decoration: underline;
    }
  }

  /* Inline Code */
  code:not(pre code) {
    background-color: hsl(var(--muted));
    padding: 0.125rem 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.875em;
    font-family:
      ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono',
      'Courier New', monospace;
  }

  /* Code Blocks */
  pre {
    background-color: hsl(var(--muted));
    padding: 0.75rem;
    border-radius: 0.5rem;
    overflow-x: auto;
    overflow-y: auto;
    margin: 1rem 0;
    max-height: 400px;
    max-width: 46rem;
    box-sizing: border-box;
    position: relative;

    /* Fade gradient at bottom to indicate scrollable content */
    &::after {
      content: '';
      display: block;
      position: sticky;
      bottom: -1rem;
      left: 0;
      right: 0;
      height: 5rem;
      background: linear-gradient(
        to bottom,
        transparent,
        hsl(var(--muted) / 0.95) 40%,
        hsl(var(--muted))
      );
      pointer-events: none;
      border-radius: 0 0 0.5rem 0.5rem;
    }

    code {
      background-color: transparent;
      padding: 0;
      border-radius: 0;
      font-size: 0.75rem;
      line-height: 1.5;
      white-space: pre;
      display: block;
      max-width: 46rem;
      min-width: 100%;
    }
  }

  /* Blockquotes */
  blockquote {
    border-left: 4px solid hsl(var(--border));
    padding-left: 1rem;
    margin: 0.5rem 0;
    color: hsl(var(--muted-foreground));
    font-style: italic;
  }

  /* Horizontal Rules */
  hr {
    border: none;
    border-top: 1px solid hsl(var(--border));
    margin: 1rem 0;
  }

  /* Images */
  img {
    max-width: 100%;
    height: auto;
    border-radius: 0.5rem;
    margin: 0.5rem 0;
  }

  /* Strong and Emphasis */
  strong {
    font-weight: 600;
  }
  em {
    font-style: italic;
  }

  /* Tables - Fallback styles (component mapping will override) */
  table {
    width: 100%;
    border-collapse: collapse;
  }
  thead {
    background-color: hsl(var(--muted));
  }
  th {
    padding: 0.75rem;
    text-align: left;
    font-weight: 500;
    border-bottom: 1px solid hsl(var(--border));
  }
  td {
    padding: 0.75rem;
    border-bottom: 1px solid hsl(var(--border));
  }
  tr:last-child td {
    border-bottom: none;
  }

  /* Task Lists */
  input[type='checkbox'] {
    margin-right: 0.5rem;
  }

  /* Strikethrough (from remark-gfm) */
  del {
    text-decoration: line-through;
    color: hsl(var(--muted-foreground));
  }
`;

// File type icon component for messages
function FileTypeIcon({
  fileType,
  fileName,
}: {
  fileType: string;
  fileName: string;
}) {
  const getFileTypeInfo = (type: string, name: string) => {
    if (type.startsWith('image/'))
      return { icon: '🖼️', label: 'IMG', bgColor: 'bg-blue-100' };
    if (type === 'application/pdf')
      return { icon: '📄', label: 'PDF', bgColor: 'bg-red-100' };
    if (
      type.includes('word') ||
      name.endsWith('.doc') ||
      name.endsWith('.docx')
    )
      return { icon: '📝', label: 'DOC', bgColor: 'bg-blue-100' };
    if (type === 'text/plain')
      return { icon: '📄', label: 'TXT', bgColor: 'bg-gray-100' };
    return { icon: '📎', label: 'FILE', bgColor: 'bg-gray-100' };
  };

  const { icon, label, bgColor } = getFileTypeInfo(fileType, fileName);

  return (
    <div
      className={`${bgColor} rounded-lg flex items-center justify-center size-8 shrink-0`}
    >
      <div className="flex flex-col items-center">
        <span className="text-xs leading-none">{icon}</span>
        <span className="text-[8px] font-medium text-foreground/80 leading-none mt-0.5">
          {label}
        </span>
      </div>
    </div>
  );
}

// File attachment component
function FileAttachmentDisplay({ attachment }: { attachment: FileAttachment }) {
  const fileUrl = useQuery(api.file.getFileUrl, { fileId: attachment.fileId });
  const isImage = attachment.fileType.startsWith('image/');

  if (!fileUrl) return null;

  if (isImage) {
    // Image attachment - small square thumbnail
    return (
      <div className="size-11 rounded-lg bg-gray-200 bg-center bg-cover bg-no-repeat overflow-hidden">
        <img
          src={fileUrl}
          alt={attachment.fileName}
          className="size-full object-cover"
        />
      </div>
    );
  }

  // File attachment - horizontal card
  return (
    <a
      href={fileUrl}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-gray-100 rounded-lg px-2 py-1.5 flex items-center gap-2 hover:bg-gray-200 transition-colors max-w-[216px]"
    >
      <FileTypeIcon
        fileType={attachment.fileType}
        fileName={attachment.fileName}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-sm font-medium text-gray-800 truncate">
          {attachment.fileName}
        </div>
        <div className="text-xs text-gray-500">
          {attachment.fileType === 'application/pdf'
            ? 'PDF'
            : attachment.fileType.includes('word')
              ? 'DOC'
              : attachment.fileType === 'text/plain'
                ? 'TXT'
                : 'FILE'}
        </div>
      </div>
    </a>
  );
}

// Optimized typewriter component for streaming text
function TypewriterText({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  const { displayText, isTyping } = useTypewriter({
    text,
    isStreaming,
    baseSpeed: 15, // Faster base speed for better responsiveness
    minSpeed: 8, // Very fast minimum speed
    maxSpeed: 30, // Reasonable maximum speed
  });

  return (
    <MarkdownWrapper>
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeRaw]}
        components={{
          table: ({ node: _node, ...props }) => (
            <div>
              <Table {...props} />
            </div>
          ),
          thead: TableHeader,
          tbody: TableBody,
          tr: TableRow,
          th: TableHead,
          td: TableCell,
        }}
      >
        {displayText}
      </Markdown>
      {isStreaming && isTyping && (
        <motion.span
          animate={{ opacity: [1, 0] }}
          transition={{
            duration: 0.6,
            repeat: Infinity,
            repeatType: 'reverse',
          }}
          className="inline-block w-2 h-4 bg-current ml-1"
        />
      )}
    </MarkdownWrapper>
  );
}

interface MessageBubbleProps extends ComponentPropsWithoutRef<'div'> {
  message: Message;
}

export default function MessageBubble({
  message,
  className,
  ...restProps
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;

  // Sanitize message content
  const sanitizedContent = useMemo(
    () => sanitizeChatMessage(message.content),
    [message.content],
  );

  // State for copy button
  const [isCopied, setIsCopied] = useState(false);
  // State for info modal
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);

  // Fetch message metadata
  const { metadata } = useMessageMetadata(message.id);

  // Handle copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  // Handle info button click
  const handleInfoClick = () => {
    setIsInfoModalOpen(true);
  };

  return (
    <div
      className={cn(
        `flex ${isUser ? 'justify-end' : 'justify-start'}`,
        className,
      )}
      {...restProps}
    >
      <div
        className={`px-4 py-3 rounded-2xl ${
          isUser
            ? 'max-w-xs lg:max-w-md bg-muted text-foreground'
            : 'text-foreground bg-background'
        }`}
      >
        {/* File attachments */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {message.attachments.map((attachment, index) => (
              <FileAttachmentDisplay key={index} attachment={attachment} />
            ))}
          </div>
        )}

        {/* Message content */}
        {message.content && (
          <div className="text-sm leading-5">
            {isAssistantStreaming ? (
              <TypewriterText text={sanitizedContent} isStreaming={true} />
            ) : (
              <MarkdownWrapper>
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={{
                    table: ({ node: _node, ...props }) => (
                      <div className="overflow-x-auto rounded-xl my-4">
                        <Table {...props} />
                      </div>
                    ),
                    thead: TableHeader,
                    tbody: TableBody,
                    tr: TableRow,
                    th: TableHead,
                    td: TableCell,
                  }}
                >
                  {sanitizedContent}
                </Markdown>
              </MarkdownWrapper>
            )}
          </div>
        )}
        {!isUser && (
          <div className="flex items-center pt-2">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="p-1"
                    onClick={handleCopy}
                  >
                    {isCopied ? (
                      <CheckIcon className="size-4 text-success" />
                    ) : (
                      <CopyIcon className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">
                  {isCopied ? 'Copied!' : 'Copy'}
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="p-1"
                    onClick={handleInfoClick}
                  >
                    <Info className="size-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Show info</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}

        {/* Info Modal */}
        <MessageInfoModal
          isOpen={isInfoModalOpen}
          onOpenChange={setIsInfoModalOpen}
          messageId={message.id}
          timestamp={message.timestamp}
          metadata={metadata}
        />
      </div>
    </div>
  );
}
