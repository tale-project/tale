'use client';

import { useUIMessages, type UIMessage } from '@convex-dev/agent/react';
import { Bot, Send, Paperclip, X, LoaderCircle, RotateCcw } from 'lucide-react';
import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import type { Id } from '@/convex/_generated/dataModel';

import { DocumentIcon } from '@/app/components/ui/data-display/document-icon';
import { Image } from '@/app/components/ui/data-display/image';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import { useConvexFileUpload } from '@/app/features/chat/hooks/use-convex-file-upload';
import { useCreateThread } from '@/app/features/chat/hooks/use-create-thread';
import { useDeleteThread } from '@/app/features/chat/hooks/use-delete-thread';
import { useThrottledScroll } from '@/app/hooks/use-throttled-scroll';
import { api } from '@/convex/_generated/api';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';
import { TEXT_FILE_ACCEPT } from '@/lib/utils/text-file-types';

import { useTestDraftAgent } from '../hooks/use-test-draft-agent';

const DUPLICATE_WINDOW_MS = 5000;
const recentSends = new Map<string, number>();

function canSendMessage(content: string, threadId: string | null): boolean {
  const key = `${threadId || 'new'}:${content.trim().toLowerCase()}`;
  const lastSent = recentSends.get(key);
  const now = Date.now();

  if (lastSent && now - lastSent < DUPLICATE_WINDOW_MS) {
    return false;
  }

  recentSends.set(key, now);
  for (const [k, time] of recentSends) {
    if (now - time > DUPLICATE_WINDOW_MS) {
      recentSends.delete(k);
    }
  }
  return true;
}

interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  fileParts?: FilePart[];
}

function ThinkingDots() {
  return (
    <div className="flex justify-start">
      <div className="text-muted-foreground flex items-center gap-2 px-3 text-xs">
        <div className="flex space-x-1">
          <div className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full" />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="bg-muted-foreground h-1 w-1 animate-bounce rounded-full"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </div>
    </div>
  );
}

interface TestChatPanelProps {
  organizationId: string;
  agentId: string;
  onClose: () => void;
}

function TestChatPanelContent({
  organizationId,
  agentId,
  onClose,
}: TestChatPanelProps) {
  const { t } = useT('settings');

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload();

  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isSendingRef = useRef(false);
  const [previewImage, setPreviewImage] = useState<{
    isOpen: boolean;
    src: string;
    alt: string;
  } | null>(null);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  const testDraftAgent = useTestDraftAgent();
  const createChatThread = useCreateThread();
  const deleteChatThread = useDeleteThread();

  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- SDK type mismatch: return type narrowed to usable shape
  const { results: uiMessages } = useUIMessages(
    // oxlint-disable-next-line typescript/no-explicit-any, typescript/no-unsafe-type-assertion -- SDK type mismatch: streaming query return type incompatible with useUIMessages expectations
    api.threads.queries.getThreadMessagesStreaming as any,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 100, stream: true },
  ) as unknown as { results: UIMessage[] | undefined };

  const transformedMessages = useMemo(() => {
    if (!uiMessages || uiMessages.length === 0) return [];

    return uiMessages
      .filter(
        (m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
      )
      .map((m) => {
        const fileParts = (
          (m.parts || []) as Array<{
            type: string;
            mediaType?: string;
            filename?: string;
            url?: string;
          }>
        )
          .filter(
            (p): p is FilePart =>
              p.type === 'file' &&
              typeof p.url === 'string' &&
              typeof p.mediaType === 'string',
          )
          .map((p) => ({
            type: 'file' as const,
            mediaType: p.mediaType,
            filename: p.filename,
            url: p.url,
          }));

        return {
          id: m.key,
          role: m.role,
          content: m.text,
          timestamp: new Date(m._creationTime),
          fileParts: fileParts.length > 0 ? fileParts : undefined,
        };
      });
  }, [uiMessages]);

  const messagesKey = useMemo(() => {
    return transformedMessages
      .map((m) => `${m.id}:${m.content.length}`)
      .join('|');
  }, [transformedMessages]);

  // Detect when the agent is still responding (streaming text or executing tools)
  // after the mutation call has returned
  const isAgentResponding = useMemo(() => {
    if (!uiMessages?.length) return false;
    return uiMessages.some(
      (m) =>
        m.role === 'assistant' &&
        (m.status === 'streaming' || m.status === 'pending'),
    );
  }, [uiMessages]);

  const isUploading = uploadingFiles.length > 0;
  const isBusy = isLoading || isAgentResponding;

  const [pendingUserMessage, setPendingUserMessage] = useState<Message | null>(
    null,
  );

  useEffect(() => {
    if (transformedMessages.length > 0) {
      setMessages(transformedMessages);
      if (pendingUserMessage) {
        const pendingTimestamp = pendingUserMessage.timestamp.getTime();
        const toleranceMs = 60000;
        const pendingContent = pendingUserMessage.content.trim().toLowerCase();
        const hasMatchingServerMessage = transformedMessages.some(
          (m) =>
            m.role === 'user' &&
            (Math.abs(m.timestamp.getTime() - pendingTimestamp) < toleranceMs ||
              m.content.trim().toLowerCase() === pendingContent),
        );
        if (hasMatchingServerMessage) {
          setPendingUserMessage(null);
        }
      }
    }
    // oxlint-disable-next-line react-hooks/exhaustive-deps -- Only re-run when messagesKey changes
  }, [messagesKey]);

  const displayMessages = useMemo(() => {
    const serverMessages =
      transformedMessages.length > 0 ? transformedMessages : messages;

    if (!pendingUserMessage) return serverMessages;
    if (serverMessages.length === 0) {
      return [pendingUserMessage];
    }
    const pendingTimestamp = pendingUserMessage.timestamp.getTime();
    const toleranceMs = 60000;
    const pendingContent = pendingUserMessage.content.trim().toLowerCase();

    const hasMatchingServerMessage = serverMessages.some(
      (m) =>
        m.role === 'user' &&
        (Math.abs(m.timestamp.getTime() - pendingTimestamp) < toleranceMs ||
          m.content.trim().toLowerCase() === pendingContent),
    );
    if (!hasMatchingServerMessage) {
      return [...serverMessages, pendingUserMessage];
    }
    return serverMessages;
  }, [transformedMessages, messages, pendingUserMessage]);

  useEffect(() => {
    if (displayMessages.length === 0) return;
    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [
    displayMessages.length,
    messagesKey,
    isAgentResponding,
    throttledScrollToBottom,
  ]);

  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      void uploadFiles(Array.from(files));
    }
    e.target.value = '';
  };

  const handlePaste = (e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    const imageFiles: File[] = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          const extension = item.type.split('/')[1] || 'png';
          const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
          const renamedFile = new File(
            [file],
            `pasted-image-${timestamp}.${extension}`,
            { type: file.type },
          );
          imageFiles.push(renamedFile);
        }
      }
    }

    if (imageFiles.length > 0) {
      void uploadFiles(imageFiles);
    }
  };

  const handleSendMessage = async () => {
    if (isSendingRef.current) return;
    if (
      (!inputValue.trim() && attachments.length === 0) ||
      isBusy ||
      isUploading ||
      !organizationId
    )
      return;

    const messageContent = inputValue.trim();

    if (!canSendMessage(messageContent, threadId)) {
      return;
    }

    isSendingRef.current = true;

    // Read attachments from React state (current render) directly — same
    // pattern as chat-input.tsx. More reliable than clearAttachments() return
    // value whose setState updater timing can vary with React 18 batching.
    const mutationAttachments =
      attachments.length > 0
        ? attachments.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

    // Clear attachments from UI (revokes preview URLs)
    if (attachments.length > 0) {
      clearAttachments();
    }

    const optimisticMessage: Message = {
      id: `pending-${Date.now()}`,
      role: 'user',
      content: messageContent,
      timestamp: new Date(),
    };
    setPendingUserMessage(optimisticMessage);

    setInputValue('');
    setIsLoading(true);

    try {
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const title =
          messageContent.length > 50
            ? `${messageContent.slice(0, 50)}...`
            : messageContent;

        currentThreadId = await createChatThread({
          organizationId,
          title,
          chatType: 'agent_test',
        });
        setThreadId(currentThreadId);
      }

      if (!currentThreadId) return;

      await testDraftAgent({
        customAgentId: agentId as Id<'customAgents'>,
        threadId: currentThreadId,
        organizationId,
        message: messageContent,
        attachments: mutationAttachments,
      });
    } catch (error) {
      console.error('Error testing draft agent:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: t('customAgents.testChat.sendFailed'),
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      isSendingRef.current = false;
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSendMessage();
    }
  };

  const handleClearChat = useCallback(async () => {
    try {
      if (threadId) {
        await deleteChatThread({ threadId });
      }
      setThreadId(null);
      setMessages([]);
      setInputValue('');
      setPendingUserMessage(null);
    } catch (error) {
      console.error('Error clearing test chat:', error);
      setThreadId(null);
      setMessages([]);
      setInputValue('');
      setPendingUserMessage(null);
    }
  }, [threadId, deleteChatThread]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">
          {t('customAgents.testChat.title')}
        </h2>
        <div className="flex items-center gap-1">
          {displayMessages.length > 0 && threadId && (
            <IconButton
              icon={RotateCcw}
              aria-label={t('customAgents.testChat.newConversation')}
              title={t('customAgents.testChat.newConversation')}
              onClick={handleClearChat}
              iconSize={3}
            />
          )}
          <IconButton
            icon={X}
            aria-label={t('customAgents.testChat.close')}
            onClick={onClose}
            iconSize={3}
          />
        </div>
      </div>

      {/* Messages */}
      <div
        ref={containerRef}
        className="relative flex flex-1 flex-col overflow-y-auto"
      >
        <div className="flex flex-1 flex-col space-y-2.5 p-3">
          {displayMessages.length === 0 ? (
            <div className="flex h-full flex-col items-start justify-start py-4">
              <div className="flex items-start gap-2">
                <div className="bg-muted h-fit shrink-0 rounded-lg p-1.5">
                  <Bot className="text-muted-foreground size-3.5" />
                </div>
                <div className="bg-muted text-foreground max-w-[85%] rounded-lg px-3 py-2">
                  <p className="text-xs">
                    {t('customAgents.testChat.welcome')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              {displayMessages.map((message) => (
                <div
                  key={message.id}
                  className={cn(
                    'flex gap-1',
                    message.role === 'user' ? 'justify-end' : 'justify-start',
                  )}
                >
                  <div className="flex max-w-[92.5%] flex-col gap-2">
                    {message.fileParts && message.fileParts.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {message.fileParts.map((part, idx) =>
                          part.mediaType.startsWith('image/') ? (
                            <button
                              key={idx}
                              type="button"
                              onClick={() =>
                                setPreviewImage({
                                  isOpen: true,
                                  src: part.url,
                                  alt: part.filename || 'Image',
                                })
                              }
                              className="bg-muted focus:ring-ring size-11 cursor-pointer overflow-hidden rounded-lg bg-cover bg-center bg-no-repeat transition-opacity hover:opacity-90 focus:ring-2 focus:ring-offset-2 focus:outline-none"
                            >
                              <Image
                                src={part.url}
                                alt={part.filename || 'Image'}
                                className="size-full object-cover"
                                width={44}
                                height={44}
                              />
                            </button>
                          ) : (
                            <a
                              key={idx}
                              href={part.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="bg-muted hover:bg-muted/80 flex max-w-[13.5rem] items-center gap-2 rounded-lg px-2 py-1.5 transition-colors"
                            >
                              <DocumentIcon
                                fileName={part.filename || 'file'}
                              />
                              <div className="flex min-w-0 flex-1 flex-col">
                                <div className="text-foreground truncate text-sm font-medium">
                                  {part.filename || 'File'}
                                </div>
                              </div>
                            </a>
                          ),
                        )}
                      </div>
                    )}
                    {message.content && (
                      <div
                        className={cn(
                          'rounded-lg px-2.5 py-2',
                          message.role === 'user'
                            ? 'bg-primary text-primary-foreground'
                            : 'bg-muted text-foreground',
                        )}
                      >
                        {message.role === 'assistant' ? (
                          <div className="prose prose-sm dark:prose-invert prose-p:my-0.5 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-pre:text-[10px] prose-headings:my-1 prose-headings:text-xs max-w-none text-xs">
                            <Bot className="text-muted-foreground mb-1.5 size-3.5" />
                            <ReactMarkdown remarkPlugins={[remarkGfm]}>
                              {message.content}
                            </ReactMarkdown>
                          </div>
                        ) : (
                          <p className="text-xs leading-relaxed whitespace-pre-wrap">
                            {message.content}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              ))}
              {isBusy && <ThinkingDots />}
            </>
          )}
          <div ref={messagesEndRef} />
        </div>
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept={TEXT_FILE_ACCEPT}
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Input */}
      <FileUpload.DropZone
        className="border-muted sticky bottom-0 z-50 mx-2 shrink-0 rounded-t-3xl border-[0.5rem] border-b-0"
        onFilesSelected={uploadFiles}
        clickable={false}
      >
        <FileUpload.Overlay className="rounded-t-2xl" />
        <div className="bg-background border-muted-foreground/50 relative rounded-t-[0.875rem] border border-b-0 p-1">
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 p-1">
              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  className="bg-muted flex items-center gap-1 rounded-lg px-2 py-1"
                >
                  <LoaderCircle className="size-3 animate-spin" />
                  <span className="text-muted-foreground text-xs">
                    {t('customAgents.testChat.uploading')}
                  </span>
                </div>
              ))}
              {attachments
                .filter((att) => att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div key={attachment.fileId} className="group relative">
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.fileName}
                      className="border-border size-8 rounded-lg border object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="bg-destructive text-destructive-foreground absolute -top-1 -right-1 rounded-full p-0.5 opacity-0 transition-opacity group-hover:opacity-100"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
              {attachments
                .filter((att) => !att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="group bg-secondary/20 relative flex max-w-[150px] items-center gap-2 rounded-lg px-2 py-1"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <div className="flex min-w-0 flex-1 flex-col">
                      <div className="text-foreground truncate text-xs font-medium">
                        {attachment.fileName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="text-muted-foreground hover:text-destructive transition-colors"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}
            </div>
          )}

          <div className="h-[5rem] overflow-y-auto transition-all duration-300 ease-in-out">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={t('customAgents.testChat.messagePlaceholder')}
              className="resize-none border-0 bg-transparent p-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
              disabled={isBusy}
            />
          </div>
          <div className="flex items-center justify-between px-1">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isBusy}
              className="text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors disabled:cursor-not-allowed disabled:opacity-50"
              title={t('customAgents.testChat.attachFiles')}
            >
              <Paperclip className="size-4" />
            </button>

            <Button
              onClick={handleSendMessage}
              disabled={
                (!inputValue.trim() && attachments.length === 0) ||
                isBusy ||
                isUploading
              }
              size="icon"
              className="rounded-full"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </FileUpload.DropZone>

      {previewImage && (
        <ImagePreviewDialog
          isOpen={previewImage.isOpen}
          onOpenChange={(open) => {
            if (!open) setPreviewImage(null);
          }}
          src={previewImage.src}
          alt={previewImage.alt}
        />
      )}
    </div>
  );
}

export function TestChatPanel(props: TestChatPanelProps) {
  return (
    <FileUpload.Root>
      <TestChatPanelContent {...props} />
    </FileUpload.Root>
  );
}
