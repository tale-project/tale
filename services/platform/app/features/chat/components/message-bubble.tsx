'use client';

import { CopyIcon, CheckIcon, Info } from 'lucide-react';
import {
  ComponentPropsWithoutRef,
  useRef,
  useState,
  useEffect,
  memo,
} from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeRaw from 'rehype-raw';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type { Message } from './message-bubble/types';

import { useMessageMetadata } from '../hooks/queries';
import {
  FileAttachmentDisplay,
  FilePartDisplay,
} from './message-bubble/file-displays';
import {
  markdownWrapperStyles,
  markdownComponents,
  TypewriterTextWrapper,
} from './message-bubble/markdown-renderer';
import { MessageInfoDialog } from './message-info-dialog';

export { ImagePreviewDialog } from './message-bubble/image-preview-dialog';

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

  const sanitizedContent = message.content
    ? message.content.replace(/\|\|+/g, '|')
    : '';

  const [isCopied, setIsCopied] = useState(false);
  const [isInfoDialogOpen, setIsInfoDialogOpen] = useState(false);
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const { metadata } = useMessageMetadata(message.id);

  useEffect(() => {
    return () => {
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
    };
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(message.content);
      setIsCopied(true);
      if (copyTimeoutRef.current) {
        clearTimeout(copyTimeoutRef.current);
      }
      copyTimeoutRef.current = setTimeout(() => setIsCopied(false), 2000);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

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
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.attachments.map((attachment, index) => (
              <FileAttachmentDisplay key={index} attachment={attachment} />
            ))}
          </div>
        )}

        {message.fileParts && message.fileParts.length > 0 && (
          <div className="mb-2 flex flex-wrap gap-1">
            {message.fileParts.map((part, index) => (
              <FilePartDisplay key={index} filePart={part} />
            ))}
          </div>
        )}

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

export const MessageBubble = memo(
  MessageBubbleComponent,
  (prevProps, nextProps) => {
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
