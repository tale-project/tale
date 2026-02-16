'use client';

import { CopyIcon, CheckIcon, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import { Info } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  ReactNode,
  useRef,
  useState,
  useEffect,
  useCallback,
  memo,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { useTheme } from '@/app/components/theme/theme-provider';
import { Image } from '@/app/components/ui/data-display/image';
import {
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/app/components/ui/data-display/table';
import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { highlightCode } from '@/lib/utils/shiki';
import {
  isTextBasedFile,
  getTextFileCategory,
  getFileExtensionLower,
} from '@/lib/utils/text-file-types';

import { useFileUrl, useMessageMetadata } from '../hooks/queries';
import { MessageInfoDialog } from './message-info-dialog';
import { PaginatedMarkdownTable } from './paginated-markdown-table';
import { TypewriterText } from './typewriter-text';

function getFileTypeLabel(
  fileName: string,
  mediaType: string,
  t: (key: string) => string,
) {
  if (mediaType === 'application/pdf') return t('fileTypes.pdf');
  if (mediaType.includes('word')) return t('fileTypes.doc');
  if (mediaType.includes('presentation') || mediaType.includes('powerpoint'))
    return t('fileTypes.pptx');
  if (mediaType === 'text/plain') return t('fileTypes.txt');
  if (isTextBasedFile(fileName, mediaType))
    return getFileExtensionLower(fileName).toUpperCase() || t('fileTypes.txt');
  return t('fileTypes.file');
}

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

// Tailwind classes for markdown content styling
const markdownWrapperStyles = cn(
  // Paragraphs
  '[&_p:not(:last-child)]:mb-2',
  // Lists
  '[&_ul]:my-2 [&_ul]:pl-4 [&_ul]:list-disc',
  '[&_ol]:my-2 [&_ol]:pl-4 [&_ol]:list-decimal',
  '[&_li]:mb-1',
  // Headings
  '[&_h1]:mb-2 [&_h1]:mt-4 [&_h1]:font-bold [&_h1]:text-2xl',
  '[&_h2]:mb-2 [&_h2]:mt-4 [&_h2]:font-bold [&_h2]:text-xl',
  '[&_h3]:mb-2 [&_h3]:mt-4 [&_h3]:font-bold [&_h3]:text-lg',
  '[&_h4]:mb-2 [&_h4]:mt-4 [&_h4]:font-bold',
  '[&_h5]:mb-2 [&_h5]:mt-4 [&_h5]:font-bold',
  '[&_h6]:mb-2 [&_h6]:mt-4 [&_h6]:font-bold',
  // Links
  '[&_a]:text-[#0561e6] [&_a]:no-underline hover:[&_a]:underline',
  // Inline code
  '[&_code:not(pre_code)]:bg-muted [&_code:not(pre_code)]:px-1 [&_code:not(pre_code)]:py-0.5 [&_code:not(pre_code)]:rounded [&_code:not(pre_code)]:text-[0.875em] [&_code:not(pre_code)]:font-mono',
  // Code blocks
  '[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-lg [&_pre]:border [&_pre]:border-border [&_pre]:overflow-auto [&_pre]:my-4 [&_pre]:max-h-[400px] [&_pre]:relative',
  '[&_pre_code]:bg-transparent [&_pre_code]:p-0 [&_pre_code]:rounded-none [&_pre_code]:text-xs [&_pre_code]:leading-relaxed [&_pre_code]:whitespace-pre [&_pre_code]:block [&_pre_code]:min-w-full',
  // Blockquotes
  '[&_blockquote]:border-l-4 [&_blockquote]:border-border [&_blockquote]:pl-4 [&_blockquote]:my-2 [&_blockquote]:text-muted-foreground [&_blockquote]:italic',
  // Horizontal rules
  '[&_hr]:border-0 [&_hr]:border-t [&_hr]:border-border [&_hr]:my-4',
  // Images
  '[&_img]:max-w-96 [&_img]:max-h-96 [&_img]:w-auto [&_img]:h-auto [&_img]:object-contain [&_img]:rounded-lg [&_img]:my-2',
  // Strong and emphasis
  '[&_strong]:font-semibold [&_em]:italic',
  // Tables (fallback styles)
  '[&_table]:w-full [&_table]:border-collapse',
  '[&_thead]:bg-muted',
  '[&_th]:p-3 [&_th]:text-left [&_th]:font-medium [&_th]:border-b [&_th]:border-border',
  '[&_td]:p-3 [&_td]:border-b [&_td]:border-border',
  '[&_tr:last-child_td]:border-b-0',
  // Task lists
  "[&_input[type='checkbox']]:mr-2",
  // Strikethrough
  '[&_del]:line-through [&_del]:text-muted-foreground',
);

// File type icon component for messages
function FileTypeIcon({
  fileType,
  fileName,
}: {
  fileType: string;
  fileName: string;
}) {
  const { t } = useT('chat');

  // Get file type info with localized labels
  const getFileTypeInfo = () => {
    if (fileType.startsWith('image/'))
      return {
        icon: '🖼️',
        label: t('fileTypes.image'),
        bgColor: 'bg-blue-100',
      };
    if (fileType === 'application/pdf')
      return { icon: '📄', label: t('fileTypes.pdf'), bgColor: 'bg-red-100' };
    if (
      fileType.includes('word') ||
      fileName.endsWith('.doc') ||
      fileName.endsWith('.docx')
    )
      return { icon: '📝', label: t('fileTypes.doc'), bgColor: 'bg-blue-100' };
    if (
      fileType.includes('presentation') ||
      fileType.includes('powerpoint') ||
      fileName.endsWith('.ppt') ||
      fileName.endsWith('.pptx')
    )
      return {
        icon: '📊',
        label: t('fileTypes.pptx'),
        bgColor: 'bg-orange-100',
      };
    if (fileType === 'text/plain')
      return { icon: '📄', label: t('fileTypes.txt'), bgColor: 'bg-gray-100' };
    if (isTextBasedFile(fileName, fileType)) {
      const category = getTextFileCategory(fileName);
      const ext = getFileExtensionLower(fileName).toUpperCase();
      if (category === 'code')
        return {
          icon: '💻',
          label: ext || t('fileTypes.code'),
          bgColor: 'bg-purple-100',
        };
      if (category === 'config')
        return {
          icon: '⚙️',
          label: ext || t('fileTypes.config'),
          bgColor: 'bg-yellow-100',
        };
      if (category === 'data')
        return {
          icon: '📊',
          label: ext || t('fileTypes.data'),
          bgColor: 'bg-green-100',
        };
      if (category === 'markup')
        return {
          icon: '📝',
          label: ext || t('fileTypes.markup'),
          bgColor: 'bg-teal-100',
        };
      return {
        icon: '📄',
        label: ext || t('fileTypes.txt'),
        bgColor: 'bg-gray-100',
      };
    }
    return { icon: '📎', label: t('fileTypes.file'), bgColor: 'bg-gray-100' };
  };

  const { icon, label, bgColor } = getFileTypeInfo();

  return (
    <div
      className={`${bgColor} flex size-8 shrink-0 items-center justify-center rounded-lg`}
    >
      <div className="flex flex-col items-center">
        <span className="text-xs leading-none">{icon}</span>
        <span className="text-foreground/80 mt-0.5 text-[8px] leading-none font-medium">
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
  const { t } = useT('chat');
  const { data: serverFileUrl } = useFileUrl(
    attachment.fileId,
    !!attachment.previewUrl,
  );
  const displayUrl = attachment.previewUrl || serverFileUrl;
  const isImage = attachment.fileType.startsWith('image/');

  if (!displayUrl) return null;

  if (isImage) {
    // Image attachment - small square thumbnail
    return (
      <div className="size-11 overflow-hidden rounded-lg bg-gray-200 bg-cover bg-center bg-no-repeat">
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
      className="flex max-w-[216px] items-center gap-2 rounded-lg bg-gray-100 px-2 py-1.5 transition-colors hover:bg-gray-200"
    >
      <FileTypeIcon
        fileType={attachment.fileType}
        fileName={attachment.fileName}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="truncate text-sm font-medium text-gray-800">
          {attachment.fileName}
        </div>
        <div className="text-xs text-gray-500">
          {getFileTypeLabel(attachment.fileName, attachment.fileType, t)}
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
  const { t } = useT('chat');
  const isImage = filePart.mediaType.startsWith('image/');

  if (isImage) {
    // Image - small square thumbnail
    return (
      <div className="bg-muted size-11 overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat">
        <img
          src={filePart.url}
          alt={filePart.filename || t('fileTypes.image')}
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
      className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
    >
      <FileTypeIcon
        fileType={filePart.mediaType}
        fileName={filePart.filename || t('fileTypes.file')}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="text-foreground truncate text-sm font-medium">
          {filePart.filename || t('fileTypes.file')}
        </div>
        <div className="text-muted-foreground text-xs">
          {getFileTypeLabel(filePart.filename || '', filePart.mediaType, t)}
        </div>
      </div>
    </a>
  );
});

/**
 * Extract the inner HTML from Shiki's codeToHtml output.
 * Shiki wraps output in `<pre class="shiki ..."><code>...tokens...</code></pre>`.
 * Since we're already inside a `<pre>` from react-markdown's CodeBlock,
 * we extract only the inner content of the `<code>` element.
 */
function extractShikiCodeContent(html: string): string {
  const codeMatch = html.match(/<code[^>]*>([\s\S]*?)<\/code>/);
  return codeMatch ? codeMatch[1] : html;
}

// Shiki-highlighted code element for fenced code blocks
const HighlightedCode = memo(function HighlightedCode({
  lang,
  code,
}: {
  lang: string;
  code: string;
}) {
  const [html, setHtml] = useState<string>('');
  const { resolvedTheme } = useTheme();
  const shikiTheme = resolvedTheme === 'dark' ? 'github-dark' : 'github-light';

  useEffect(() => {
    let cancelled = false;
    void highlightCode(code, lang, shikiTheme).then((result) => {
      if (!cancelled && result) setHtml(extractShikiCodeContent(result));
    });
    return () => {
      cancelled = true;
    };
  }, [code, lang, shikiTheme]);

  if (!html) {
    const lines = code.split('\n');
    return (
      <code>
        {lines.map((line, i) => (
          <span key={i} className="line">
            {line}
            {i < lines.length - 1 ? '\n' : ''}
          </span>
        ))}
      </code>
    );
  }

  return <code dangerouslySetInnerHTML={{ __html: html }} />;
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
    <div className="group code-line-numbers relative">
      <pre
        ref={preRef}
        {...props}
        className="max-w-(--chat-max-width) overflow-x-auto"
      >
        {children}
      </pre>
      <Button
        variant="ghost"
        size="icon"
        className="bg-background/80 hover:bg-background absolute top-2 right-2 size-7 opacity-0 transition-opacity group-hover:opacity-100"
        onClick={handleCopy}
      >
        {isCopied ? (
          <CheckIcon className="text-success size-3.5" />
        ) : (
          <CopyIcon className="size-3.5" />
        )}
      </Button>
    </div>
  );
}

// Zoom constants for image preview
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 3;
const ZOOM_STEP = 0.25;

// Reusable image preview dialog with zoom functionality
interface ImagePreviewDialogProps {
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  src: string;
  alt: string;
}

export const ImagePreviewDialog = memo(function ImagePreviewDialog({
  isOpen,
  onOpenChange,
  src,
  alt,
}: ImagePreviewDialogProps) {
  const { t } = useT('chat');
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef<HTMLDivElement>(null);

  const handleClose = useCallback(
    (open: boolean) => {
      onOpenChange(open);
      if (!open) {
        setZoom(1);
      }
    },
    [onOpenChange],
  );

  const handleZoomIn = useCallback(() => {
    setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
  }, []);

  const handleZoomOut = useCallback(() => {
    setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
  }, []);

  const handleResetZoom = useCallback(() => {
    setZoom(1);
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.deltaY < 0) {
        setZoom((prev) => Math.min(prev + ZOOM_STEP, MAX_ZOOM));
      } else {
        setZoom((prev) => Math.max(prev - ZOOM_STEP, MIN_ZOOM));
      }
    };

    container.addEventListener('wheel', handleWheel, { passive: false });
    return () => container.removeEventListener('wheel', handleWheel);
  }, []);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={handleClose}
      title={t('imagePreview')}
      size="wide"
      hideClose
      className="flex flex-col border-0 bg-black/95 p-0 ring-0 sm:p-0"
      customHeader={
        <div className="absolute top-4 right-4 left-4 z-10 flex items-center justify-between">
          <span className="max-w-[60%] truncate text-sm text-white/80">
            {alt}
          </span>
          <div className="flex items-center gap-1 rounded-lg bg-black/50 p-1">
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomOut}
              disabled={zoom <= MIN_ZOOM}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.zoomOut')}
            >
              <ZoomOut className="size-4" />
            </Button>
            <span className="min-w-[3rem] text-center text-sm text-white">
              {Math.round(zoom * 100)}%
            </span>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleZoomIn}
              disabled={zoom >= MAX_ZOOM}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.zoomIn')}
            >
              <ZoomIn className="size-4" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleResetZoom}
              disabled={zoom === 1}
              className="size-8 text-white hover:bg-white/20 disabled:opacity-50"
              aria-label={t('imageViewer.resetZoom')}
            >
              <RotateCcw className="size-4" />
            </Button>
          </div>
        </div>
      }
    >
      <div
        ref={containerRef}
        className="flex flex-1 items-center justify-center overflow-auto p-8 pt-16"
      >
        <img
          src={src}
          alt={alt}
          style={{
            transform: `scale(${zoom})`,
            transformOrigin: 'center center',
            transition: 'transform 0.15s ease-out',
          }}
          className="max-h-full max-w-full object-contain"
          draggable={false}
        />
      </div>
    </Dialog>
  );
});

// Memoized image component for markdown - prevents flicker during streaming
const MarkdownImage = memo(function MarkdownImage(
  props: React.ImgHTMLAttributes<HTMLImageElement>,
) {
  const { t } = useT('chat');
  const [isOpen, setIsOpen] = useState(false);
  const altText =
    typeof props.alt === 'string' ? props.alt : t('fileTypes.image');
  const imageSrc = typeof props.src === 'string' ? props.src : '';

  const handleOpen = () => setIsOpen(true);

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="focus:ring-ring font-inherit my-2 inline-block cursor-pointer appearance-none rounded-lg border-none bg-transparent p-0 transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
      >
        <Image
          src={imageSrc}
          alt={altText}
          width={384}
          height={384}
          className="max-h-[24rem] w-auto max-w-[24rem] rounded-lg object-contain"
        />
      </button>
      <ImagePreviewDialog
        isOpen={isOpen}
        onOpenChange={setIsOpen}
        src={imageSrc}
        alt={altText}
      />
    </>
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
  code: ({
    node: _node,
    className,
    children,
    ...props
  }: { node?: unknown } & React.HTMLAttributes<HTMLElement>) => {
    const match = className?.match(/language-(\w+)/);
    if (match) {
      return (
        <HighlightedCode
          lang={match[1]}
          code={(Array.isArray(children)
            ? children.join('')
            : typeof children === 'string'
              ? children
              : ''
          ).replace(/\n$/, '')}
        />
      );
    }
    return (
      <code className={className} {...props}>
        {children}
      </code>
    );
  },
  img: ({
    node: _node,
    ...props
  }: { node?: unknown } & React.ImgHTMLAttributes<HTMLImageElement>) => (
    <MarkdownImage {...props} />
  ),
};

/**
 * TypewriterTextWrapper - Wraps the TypewriterText component with markdown styling
 *
 * Uses the new optimized TypewriterText component which features:
 * - Hybrid CSS+JS animation for smooth 60fps text reveal
 * - Incremental markdown parsing (stable/streaming split)
 * - Tab visibility detection (pauses when hidden)
 * - Reduced motion support (instant reveal if preferred)
 * - Word boundary snapping for natural reading flow
 */
function TypewriterTextWrapper({
  text,
  isStreaming = false,
}: {
  text: string;
  isStreaming?: boolean;
}) {
  return (
    <TypewriterText
      text={text}
      isStreaming={isStreaming}
      components={markdownComponents}
      className={markdownWrapperStyles}
    />
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
  const { t } = useT('common');
  const isUser = message.role === 'user';
  const isAssistantStreaming =
    message.role === 'assistant' && message.isStreaming;

  // rehype-raw allows raw HTML in markdown, rehype-sanitize removes dangerous elements

  // Sanitize markdown tables to fix malformed syntax (e.g., double pipes ||)
  const sanitizedContent = message.content
    ? message.content
        // Fix double pipes in table rows (e.g., "||value" -> "| value" or "value||" -> "value |")
        .replace(/\|\|+/g, '|')
    : '';

  // State for copy button
  const [isCopied, setIsCopied] = useState(false);
  // State for info dialog
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
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
    setIsInfoDialogOpen(true);
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
        className={`rounded-2xl px-4 py-3 ${
          isUser
            ? 'bg-muted text-foreground max-w-xs lg:max-w-md'
            : 'text-foreground bg-background'
        }`}
      >
        {/* File attachments - optimistic (local preview) */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.attachments.map((attachment, index) => (
              <FileAttachmentDisplay key={index} attachment={attachment} />
            ))}
          </div>
        )}

        {/* File parts - from server (UIMessage.parts) */}
        {message.fileParts && message.fileParts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.fileParts.map((part, index) => (
              <FilePartDisplay key={index} filePart={part} />
            ))}
          </div>
        )}

        {/* Message content */}
        {sanitizedContent && (
          <div className="text-sm leading-5">
            {isAssistantStreaming ? (
              <TypewriterTextWrapper
                text={sanitizedContent}
                isStreaming={true}
              />
            ) : (
              <div className={markdownWrapperStyles}>
                <Markdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize]}
                  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- react-markdown Components type requires ExtraProps on forwardRef components
                  components={markdownComponents as Components}
                >
                  {sanitizedContent}
                </Markdown>
              </div>
            )}
          </div>
        )}
        {!isUser && !isAssistantStreaming && (
          <div className="flex items-center pt-2">
            <Tooltip
              content={isCopied ? t('actions.copied') : t('actions.copy')}
              side="bottom"
            >
              <Button
                variant="ghost"
                size="icon"
                className="p-1"
                onClick={handleCopy}
              >
                {isCopied ? (
                  <CheckIcon className="text-success size-4" />
                ) : (
                  <CopyIcon className="size-4" />
                )}
              </Button>
            </Tooltip>
            <Tooltip content={t('actions.showInfo')} side="bottom">
              <Button
                variant="ghost"
                size="icon"
                className="p-1"
                onClick={handleInfoClick}
              >
                <Info className="size-4" />
              </Button>
            </Tooltip>
          </div>
        )}

        {/* Info Dialog */}
        <MessageInfoDialog
          isOpen={isInfoDialogOpen}
          onOpenChange={setIsInfoDialogOpen}
          messageId={message.id}
          timestamp={message.timestamp}
          metadata={metadata}
        />
      </div>
    </div>
  );
}

// Memoize to prevent re-renders when parent state changes (e.g., typing in input)
export const MessageBubble = memo(
  MessageBubbleComponent,
  (prevProps, nextProps) => {
    // Only re-render if message content or relevant properties changed
    return (
      prevProps.message.id === nextProps.message.id &&
      prevProps.message.content === nextProps.message.content &&
      prevProps.message.isStreaming === nextProps.message.isStreaming &&
      prevProps.message.attachments === nextProps.message.attachments &&
      prevProps.message.fileParts === nextProps.message.fileParts &&
      prevProps.className === nextProps.className
    );
  },
);
