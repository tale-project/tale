'use client';

import { cn } from '@/lib/utils/cn';
import {
  ComponentPropsWithoutRef,
  ReactNode,
  useRef,
  useState,
  useEffect,
  memo,
} from 'react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeRaw from 'rehype-raw';
import styled from 'styled-components';
import { motion } from 'framer-motion';
import { useTypewriter } from '../hooks/use-typewriter';
import { CopyIcon, CheckIcon } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import PaginatedMarkdownTable from './paginated-markdown-table';
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
  previewUrl?: string; // Local preview URL for optimistic display
}

// File part from server messages (via UIMessage.parts)
interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

interface Message {
  id: string;
  content: string;
  role: 'user' | 'assistant';
  timestamp: Date;
  isStreaming?: boolean;
  attachments?: FileAttachment[]; // For optimistic messages
  fileParts?: FilePart[]; // For server messages
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
    border: 1px solid hsl(var(--border));
    overflow-x: auto;
    overflow-y: auto;
    margin: 1rem 0;
    max-height: 400px;
    max-width: calc(var(--chat-max-width) - 6rem));
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
      max-width: var(--chat-max-width);
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
    max-width: 24rem;
    max-height: 24rem;
    width: auto;
    height: auto;
    object-fit: contain;
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

// File attachment component - memoized to prevent re-renders during streaming
const FileAttachmentDisplay = memo(function FileAttachmentDisplay({
  attachment,
}: {
  attachment: FileAttachment;
}) {
  // Use previewUrl for optimistic display, otherwise fetch from server
  const serverFileUrl = useQuery(
    api.file.getFileUrl,
    attachment.previewUrl ? 'skip' : { fileId: attachment.fileId },
  );
  const displayUrl = attachment.previewUrl || serverFileUrl;
  const isImage = attachment.fileType.startsWith('image/');

  if (!displayUrl) return null;

  if (isImage) {
    // Image attachment - small square thumbnail
    return (
      <div className="size-11 rounded-lg bg-gray-200 bg-center bg-cover bg-no-repeat overflow-hidden">
        <img
          src={displayUrl}
          alt={attachment.fileName}
          className="size-full object-cover"
        />
      </div>
    );
  }

  // File attachment - horizontal card
  return (
    <a
      href={displayUrl}
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
});

// File part component (for server messages with UIMessage.parts) - memoized to prevent re-renders during streaming
const FilePartDisplay = memo(function FilePartDisplay({
  filePart,
}: {
  filePart: FilePart;
}) {
  const isImage = filePart.mediaType.startsWith('image/');

  if (isImage) {
    // Image - small square thumbnail
    return (
      <div className="size-11 rounded-lg bg-muted bg-center bg-cover bg-no-repeat overflow-hidden">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={filePart.url}
          alt={filePart.filename || 'Image'}
          className="size-full object-cover"
        />
      </div>
    );
  }

  // Non-image file - horizontal card
  return (
    <a
      href={filePart.url}
      target="_blank"
      rel="noopener noreferrer"
      className="bg-muted rounded-lg px-2 py-1.5 flex items-center gap-2 hover:bg-muted/80 transition-colors max-w-[13.5rem]"
    >
      <FileTypeIcon
        fileType={filePart.mediaType}
        fileName={filePart.filename || 'file'}
      />
      <div className="flex flex-col min-w-0 flex-1">
        <div className="text-sm font-medium text-foreground truncate">
          {filePart.filename || 'File'}
        </div>
        <div className="text-xs text-muted-foreground">
          {filePart.mediaType === 'application/pdf'
            ? 'PDF'
            : filePart.mediaType.includes('word')
              ? 'DOC'
              : filePart.mediaType === 'text/plain'
                ? 'TXT'
                : 'FILE'}
        </div>
      </div>
    </a>
  );
});

// Code block with copy button
function CodeBlock({
  children,
  ...props
}: ComponentPropsWithoutRef<'pre'> & { children?: ReactNode }) {
  const [isCopied, setIsCopied] = useState(false);
  const preRef = useRef<HTMLPreElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    const textContent = preRef.current?.textContent ?? '';

    try {
      await navigator.clipboard.writeText(textContent);
      setIsCopied(true);
      // Clear any existing timeout before setting a new one
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
      timeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy code:', error);
    }
  };

  return (
    <div className="relative group">
      <pre
        ref={preRef}
        {...props}
        className="max-w-[var(--chat-max-width)] overflow-x-auto"
      >
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-2 right-2 size-7 opacity-0 group-hover:opacity-100 transition-opacity bg-background/80 hover:bg-background"
        onClick={handleCopy}
      >
        {isCopied ? (
          <CheckIcon className="size-3.5 text-success" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

// Memoized image component for markdown - prevents flicker during streaming
const MarkdownImage = memo(function MarkdownImage(
  props: React.ImgHTMLAttributes<HTMLImageElement>,
) {
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      {...props}
      className="max-w-[24rem] max-h-[24rem] w-auto h-auto object-contain rounded-lg my-2"
      loading="lazy"
      alt={typeof props.alt === 'string' ? props.alt : 'Image'}
    />
  );
});

// Stable markdown components object - defined outside render to prevent recreation
const markdownComponents = {
  table: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLTableElement>) => (
    <PaginatedMarkdownTable {...props} />
  ),
  thead: TableHeader,
  tbody: TableBody,
  tr: TableRow,
  th: TableHead,
  td: TableCell,
  pre: ({
    node: _node,
    ...props
  }: { node?: unknown } & ComponentPropsWithoutRef<'pre'>) => (
    <CodeBlock {...props} />
  ),
  img: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.ImgHTMLAttributes<HTMLImageElement>) => (
    <MarkdownImage {...props} />
  ),
};

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
        components={markdownComponents}
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

function MessageBubbleComponent({
  message,
  className,
  ...restProps
}: MessageBubbleProps) {
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;

  // Note: We don't sanitize markdown content before passing to react-markdown
  // react-markdown safely parses markdown without XSS risks
  // DOMPurify would encode special chars like > as &gt; breaking code blocks

  // State for copy button
  const [isCopied, setIsCopied] = useState(false);
  // State for info modal
  const [isInfoModalOpen, setIsInfoModalOpen] = useState(false);
  // Ref for copy timeout cleanup
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Fetch message metadata
  const { metadata } = useMessageMetadata(message.id);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  // Handle copy to clipboard
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      // Clear any existing timeout before setting a new one
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
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
        {/* File attachments - optimistic (local preview) */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {message.attachments.map((attachment, index) => (
              <FileAttachmentDisplay key={index} attachment={attachment} />
            ))}
          </div>
        )}

        {/* File parts - from server (UIMessage.parts) */}
        {message.fileParts && message.fileParts.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-2">
            {message.fileParts.map((part, index) => (
              <FilePartDisplay key={index} filePart={part} />
            ))}
          </div>
        )}

        {/* Message content */}
        {message.content && (
          <div className="text-sm leading-5">
            {isAssistantStreaming ? (
              <TypewriterText text={message.content} isStreaming={true} />
            ) : (
              <MarkdownWrapper>
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw]}
                  components={markdownComponents}
                >
                  {message.content}
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

// Memoize to prevent re-renders when parent state changes (e.g., typing in input)
const MessageBubble = memo(MessageBubbleComponent, (prevProps, nextProps) => {
  // Only re-render if message content or relevant properties changed
  return (
    prevProps.message.id === nextProps.message.id &&
    prevProps.message.content === nextProps.message.content &&
    prevProps.message.isStreaming === nextProps.message.isStreaming &&
    prevProps.message.attachments === nextProps.message.attachments &&
    prevProps.message.fileParts === nextProps.message.fileParts &&
    prevProps.className === nextProps.className
  );
});

export default MessageBubble;
