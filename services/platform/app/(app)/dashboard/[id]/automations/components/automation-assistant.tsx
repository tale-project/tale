'use client';

import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/textarea';
import {
  Bot,
  Sparkles,
  Send,
  ChevronDown,
  ChevronRight,
  Trash2,
  Paperclip,
  X,
  LoaderCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils/cn';
import { stripWorkflowContext } from '@/lib/utils/message-helpers';
import { useState, useRef, useEffect } from 'react';
import { Id } from '@/convex/_generated/dataModel';
import { useAction, useMutation, useQuery } from 'convex/react';
import { api } from '@/convex/_generated/api';
import { motion } from 'framer-motion';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useAuth } from '@/hooks/use-convex-auth';
import { useThrottledScroll } from '@/hooks/use-throttled-scroll';
import { toast } from '@/hooks/use-toast';
import DocumentIcon from '@/components/ui/document-icon';
import { useUIMessages } from '@convex-dev/agent/react';

interface FileAttachment {
  fileId: Id<'_storage'>;
  fileName: string;
  fileType: string;
  fileSize: number;
  previewUrl?: string;
}

// File part from UIMessage.parts
interface FilePart {
  type: 'file';
  mediaType: string;
  filename?: string;
  url: string;
}

export interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
  automationContext?: string; // Optional automation context for first user message
  fileParts?: FilePart[]; // File parts from server messages
}

function AutomationDetailsCollapse({ context }: { context: string }) {
  const [isOpen, setIsOpen] = useState(false);

  return (
    <div className="border border-muted rounded-lg overflow-hidden mb-2">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full flex items-center justify-between px-3 py-2 bg-muted/50 hover:bg-muted transition-colors text-left"
      >
        <span className="text-xs font-medium text-muted-foreground">
          Automation Details
        </span>
        {isOpen ? (
          <ChevronDown className="size-3.5 text-muted-foreground" />
        ) : (
          <ChevronRight className="size-3.5 text-muted-foreground" />
        )}
      </button>
      {isOpen && (
        <div className="px-3 py-2 bg-background">
          <pre className="text-xs text-muted-foreground whitespace-pre-wrap font-mono">
            {context}
          </pre>
        </div>
      )}
    </div>
  );
}

function ThinkingAnimation() {
  const [currentStep, setCurrentStep] = useState(0);

  const thinkingSteps = [
    'Thinking',
    'Analyzing workflow',
    'Compiling an answer',
  ];

  useEffect(() => {
    let interval: NodeJS.Timeout;

    if (currentStep < thinkingSteps.length - 1) {
      interval = setInterval(() => {
        setCurrentStep((prev) => prev + 1);
      }, 2500);
    }

    return () => {
      if (interval) clearInterval(interval);
    };
  }, [currentStep, thinkingSteps.length]);

  return (
    <div className="flex justify-start">
      <motion.div
        key={currentStep}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{
          duration: 0.2,
          ease: 'easeInOut',
        }}
        className="text-xs text-muted-foreground flex items-center gap-2 px-3"
      >
        <motion.span
          key={currentStep}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{
            duration: 0.2,
            ease: 'easeInOut',
          }}
          className="inline-block"
        >
          {thinkingSteps[currentStep]}
        </motion.span>
        <div className="flex space-x-1">
          <div className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce" />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.1s' }}
          />
          <div
            className="w-1 h-1 bg-muted-foreground rounded-full animate-bounce"
            style={{ animationDelay: '0.2s' }}
          />
        </div>
      </motion.div>
    </div>
  );
}

interface AutomationAssistantProps {
  automationId?: Id<'wfDefinitions'>;
  organizationId: string;
  onClearChat?: () => void;
}

export function AutomationAssistant({
  automationId,
  organizationId,
  onClearChat,
}: AutomationAssistantProps) {
  const { user } = useAuth();
  const [messages, setMessages] = useState<Message[]>([]);
  const [inputValue, setInputValue] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [threadId, setThreadId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [attachments, setAttachments] = useState<FileAttachment[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [uploadingFiles, setUploadingFiles] = useState<string[]>([]);
  const { throttledScrollToBottom, cleanup } = useThrottledScroll({
    delay: 16,
  });

  const generateUploadUrl = useMutation(api.file.generateUploadUrl);

  // Connect to workflow assistant agent
  const chatWithWorkflowAssistant = useAction(
    api.workflow_assistant_agent.chatWithWorkflowAssistant,
  );
  const createChatThread = useMutation(api.threads.createChatThread);
  const deleteChatThread = useMutation(api.threads.deleteChatThread);
  const updateWorkflowMetadata = useMutation(
    api.wf_definitions.updateWorkflowMetadata,
  );

  // Load workflow to get threadId from metadata (use public API)
  const workflow = useQuery(
    api.wf_definitions.getWorkflowPublic,
    automationId ? { wfDefinitionId: automationId } : 'skip',
  );

  // Load thread messages when threadId is available using useUIMessages for file parts support
  const { results: uiMessages } = useUIMessages(
    api.threads.getThreadMessagesStreaming,
    threadId ? { threadId } : 'skip',
    { initialNumItems: 50, stream: true },
  );

  // Load threadId from workflow metadata when workflow is loaded
  useEffect(() => {
    if (workflow?.metadata?.threadId && !threadId) {
      setThreadId(workflow.metadata.threadId);
    }
  }, [workflow, threadId, automationId]);

  // Sync messages from thread - always use thread as source of truth when available
  useEffect(() => {
    if (uiMessages && uiMessages.length > 0) {
      const threadMsgs: Message[] = uiMessages
        .filter((m): m is typeof m & { role: 'user' | 'assistant' } =>
          m.role === 'user' || m.role === 'assistant',
        )
        .map((m) => {
          // Extract file parts (images) from UIMessage.parts
          const fileParts = ((m.parts || []) as Array<{ type: string; mediaType?: string; filename?: string; url?: string }>)
            .filter((p): p is FilePart => p.type === 'file' && typeof p.url === 'string' && typeof p.mediaType === 'string')
            .map((p) => ({
              type: 'file' as const,
              mediaType: p.mediaType,
              filename: p.filename,
              url: p.url,
            }));

          return {
            id: m.key,
            role: m.role,
            content:
              m.role === 'user' ? stripWorkflowContext(m.text) : m.text,
            timestamp: new Date(m._creationTime),
            fileParts: fileParts.length > 0 ? fileParts : undefined,
          };
        });
      setMessages(threadMsgs);
    }
  }, [uiMessages]);

  // Scroll to bottom when new messages arrive using throttled scroll
  useEffect(() => {
    if (messages.length === 0) return;

    if (containerRef.current) {
      throttledScrollToBottom(containerRef.current, 'auto');
    }
  }, [messages.length, throttledScrollToBottom]);

  // Cleanup throttled scroll on unmount
  useEffect(() => {
    return cleanup;
  }, [cleanup]);

  // File upload functions
  const uploadFiles = async (files: FileList) => {
    const fileArray = Array.from(files);
    const maxFileSize = 10 * 1024 * 1024; // 10MB limit
    const allowedTypes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'image/webp',
      'application/pdf',
      'text/plain',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];

    // Validate files
    const invalidFiles = fileArray.filter(
      (file) => file.size > maxFileSize || !allowedTypes.includes(file.type),
    );

    if (invalidFiles.length > 0) {
      toast({
        title: 'Invalid files',
        description: `Some files are too large (>10MB) or not supported. Supported: images, PDF, Word docs, text files.`,
        variant: 'destructive',
      });
      return;
    }

    // Upload each file
    const uploadPromises = fileArray.map(async (file) => {
      const fileId = `${file.name}-${Date.now()}`;
      setUploadingFiles((prev) => [...prev, fileId]);

      try {
        // Get upload URL from Convex
        const uploadUrl = await generateUploadUrl();

        // Upload file to Convex storage
        const result = await fetch(uploadUrl, {
          method: 'POST',
          headers: { 'Content-Type': file.type },
          body: file,
        });

        if (!result.ok) {
          throw new Error('Upload failed');
        }

        const { storageId } = await result.json();

        // Create attachment object
        const attachment: FileAttachment = {
          fileId: storageId,
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          previewUrl: file.type.startsWith('image/')
            ? URL.createObjectURL(file)
            : undefined,
        };

        setAttachments((prev) => [...prev, attachment]);

        toast({
          title: 'File uploaded',
          description: `${file.name} uploaded successfully`,
        });
      } catch (error) {
        console.error('Upload error:', error);
        toast({
          title: 'Upload failed',
          description: `Failed to upload ${file.name}`,
          variant: 'destructive',
        });
      } finally {
        setUploadingFiles((prev) => prev.filter((id) => id !== fileId));
      }
    });

    await Promise.all(uploadPromises);
  };

  const removeAttachment = (fileId: Id<'_storage'>) => {
    setAttachments((prev) => {
      const attachment = prev.find((att) => att.fileId === fileId);
      if (attachment?.previewUrl) {
        URL.revokeObjectURL(attachment.previewUrl);
      }
      return prev.filter((att) => att.fileId !== fileId);
    });
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
    // Reset input to allow selecting the same file again
    e.target.value = '';
  };

  // Handle paste event for images
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
      const dataTransfer = new DataTransfer();
      imageFiles.forEach((file) => dataTransfer.items.add(file));
      uploadFiles(dataTransfer.files);
    }
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      uploadFiles(files);
    }
  };

  const handleSendMessage = async () => {
    if ((!inputValue.trim() && attachments.length === 0) || isLoading || !organizationId) return;

    const messageContent = inputValue.trim();

    // Capture attachments before clearing
    const attachmentsToSend = attachments.length > 0 ? [...attachments] : undefined;

    // Clear input and attachments immediately for better UX
    setInputValue('');
    // Clean up preview URLs before clearing
    attachments.forEach((att) => {
      if (att.previewUrl) {
        URL.revokeObjectURL(att.previewUrl);
      }
    });
    setAttachments([]);
    setIsLoading(true);

    try {
      // Ensure we have a real Agent thread for this automation chat
      let currentThreadId = threadId;
      if (!currentThreadId) {
        const title =
          messageContent.length > 50
            ? `${messageContent.substring(0, 50)}...`
            : messageContent;

        currentThreadId = await createChatThread({
          organizationId: organizationId as string,
          title,
          chatType: 'workflow_assistant',
        });
        setThreadId(currentThreadId);
      }

      // Prepare attachments for the agent
      const mutationAttachments = attachmentsToSend
        ? attachmentsToSend.map((a) => ({
            fileId: a.fileId,
            fileName: a.fileName,
            fileType: a.fileType,
            fileSize: a.fileSize,
          }))
        : undefined;

      // Call the workflow assistant agent with a real Agent thread id
      // Messages will be automatically synced from threadMessages query
      await chatWithWorkflowAssistant({
        threadId: currentThreadId!,
        organizationId,
        workflowId: automationId,
        message: messageContent || 'Please analyze the attached files.',
        attachments: mutationAttachments,
      });
    } catch (error) {
      console.error('Error calling workflow assistant:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content:
          "I'm sorry, I encountered an error. Please try again or check the console for details.",
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  const handleClearChat = async () => {
    if (!user?._id) {
      console.error('User not authenticated');
      return;
    }

    try {
      // Delete the thread if it exists
      if (threadId) {
        await deleteChatThread({
          threadId: threadId,
        });
      }

      // Reset threadId in workflow metadata if automationId exists
      if (automationId && workflow?.metadata) {
        await updateWorkflowMetadata({
          wfDefinitionId: automationId,
          metadata: { ...workflow.metadata, threadId: null },
          updatedBy: user._id,
        });
      }

      // Reset local state
      setThreadId(null);
      setMessages([]);
      setInputValue('');

      // Call parent callback if provided
      onClearChat?.();
    } catch (error) {
      console.error('Error clearing chat:', error);
      // Still reset local state even if server updates fail
      setThreadId(null);
      setMessages([]);
      setInputValue('');
    }
  };

  return (
    <>
      {/* Header with clear button */}
      {messages.length > 0 && threadId && (
        <Button
          variant="ghost"
          size="icon"
          onClick={handleClearChat}
          className="h-8 w-8 absolute top-3.5 right-2"
        >
          <Trash2 className="size-4" />
        </Button>
      )}

      {/* Chat messages */}
      <div
        ref={containerRef}
        className="flex-1 flex flex-col overflow-y-auto p-2 space-y-2.5"
      >
        {messages.length === 0 ? (
          <div className="flex flex-col items-start justify-start h-full py-4">
            <div className="flex gap-2 items-start">
              <div className="p-1.5 rounded-lg bg-muted shrink-0 h-fit">
                <Bot className="size-3.5 text-muted-foreground" />
              </div>
              <div className="rounded-lg px-3 py-2 bg-muted text-foreground max-w-[85%]">
                <p className="text-xs">
                  {workflow?.status === 'draft'
                    ? "Hi! I'm your automation assistant. I can help you create and edit this automation. Just describe what you want to automate, and I'll build it for you!"
                    : "Hi! I'm your automation assistant. I can help you understand and discuss this automation. What would you like to know?"}
                </p>
              </div>
            </div>
          </div>
        ) : (
          <>
            {messages.map((message) => (
              <div
                key={message.id}
                className={cn(
                  'flex gap-1',
                  message.role === 'user' ? 'justify-end' : 'justify-start',
                )}
              >
                <div className="flex flex-col gap-2 max-w-[92.5%]">
                  {message.automationContext && (
                    <AutomationDetailsCollapse
                      context={message.automationContext}
                    />
                  )}
                  {/* Display file parts (images) */}
                  {message.fileParts && message.fileParts.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {message.fileParts.map((part, index) =>
                        part.mediaType.startsWith('image/') ? (
                          <div
                            key={index}
                            className="size-11 rounded-lg bg-gray-200 bg-center bg-cover bg-no-repeat overflow-hidden"
                          >
                            <img
                              src={part.url}
                              alt={part.filename || 'Image'}
                              className="size-full object-cover"
                            />
                          </div>
                        ) : (
                          <a
                            key={index}
                            href={part.url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="bg-gray-100 rounded-lg px-2 py-1.5 flex items-center gap-2 hover:bg-gray-200 transition-colors max-w-[216px]"
                          >
                            <DocumentIcon
                              fileName={part.filename || 'file'}
                            />
                            <div className="flex flex-col min-w-0 flex-1">
                              <div className="text-sm font-medium text-gray-800 truncate">
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
                        'rounded-lg px-3 py-2',
                        message.role === 'user'
                          ? 'bg-primary text-primary-foreground'
                          : 'bg-muted text-foreground',
                      )}
                    >
                      {message.role === 'assistant' ? (
                        <div className="text-xs prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-pre:my-1 prose-pre:bg-muted/50 prose-pre:border prose-pre:border-border prose-pre:rounded-md prose-pre:p-2 prose-pre:overflow-x-auto prose-headings:my-2 [&_li]:mb-1 [&_ul]:my-2 [&_ul]:pl-4 [&_ul]:list-disc [&_ol]:mb-1 [&_ol]:mt-1 [&_ol]:pl-4 [&_ol]:list-decimal [&_ol]:list-decimal-leading-zero [&_code]:bg-muted-foreground/10 [&_code]:text-[10px] [&_code]:text-muted-foreground [&_code]:px-1 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:font-mono [&_code]:break-words [&_code]:whitespace-normal [&_code]:inline-block [&_code]:max-w-full [&_pre_code]:overflow-auto [&_pre_code]:block [&_pre_code]:whitespace-pre [&_pre_code]:break-normal [&_p]:mb-1 [&_p]:mt-1 [&_p]:break-words [&_h3]:mt-2">
                          <Bot className="size-4 text-muted-foreground mb-2" />
                          <ReactMarkdown remarkPlugins={[remarkGfm]}>
                            {message.content}
                          </ReactMarkdown>
                        </div>
                      ) : (
                        <p className="text-xs whitespace-pre-wrap">
                          {message.content}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              </div>
            ))}
            {isLoading && <ThinkingAnimation />}
          </>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept="image/*,.pdf,.doc,.docx,.txt"
        onChange={handleFileInputChange}
        style={{ display: 'none' }}
      />

      {/* Chat input */}
      <div
        className={cn(
          'border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2 sticky bottom-0 z-50',
          isDragOver && 'ring-2 ring-primary ring-offset-2',
        )}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="bg-background rounded-t-[0.875rem] relative p-1 border border-muted-foreground/50 border-b-0">
          {/* Attachment previews */}
          {(attachments.length > 0 || uploadingFiles.length > 0) && (
            <div className="flex flex-wrap gap-2 p-2 border-b border-border">
              {/* Uploading files indicator */}
              {uploadingFiles.map((fileId) => (
                <div
                  key={fileId}
                  className="flex items-center gap-1 bg-muted rounded-lg px-2 py-1"
                >
                  <LoaderCircle className="size-3 animate-spin" />
                  <span className="text-xs text-muted-foreground">
                    Uploading...
                  </span>
                </div>
              ))}

              {/* Image previews */}
              {attachments
                .filter((att) => att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div key={attachment.fileId} className="relative group">
                    <img
                      src={attachment.previewUrl}
                      alt={attachment.fileName}
                      className="w-12 h-12 object-cover rounded-lg border border-border"
                    />
                    <button
                      type="button"
                      onClick={() => removeAttachment(attachment.fileId)}
                      className="absolute -top-1 -right-1 bg-destructive text-destructive-foreground rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                ))}

              {/* File attachments */}
              {attachments
                .filter((att) => !att.fileType.startsWith('image/'))
                .map((attachment) => (
                  <div
                    key={attachment.fileId}
                    className="relative group bg-secondary/20 rounded-lg px-2 py-1 flex items-center gap-2 max-w-[150px]"
                  >
                    <DocumentIcon fileName={attachment.fileName} />
                    <div className="flex flex-col min-w-0 flex-1">
                      <div className="text-xs font-medium text-foreground truncate">
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

          <div className="transition-all duration-300 ease-in-out overflow-y-auto h-[3rem]">
            <Textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder="Type your message..."
              className="resize-none border-0 outline-none bg-transparent p-2 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm min-h-[2.5rem]"
              disabled={isLoading}
            />
          </div>
          <div className="flex items-center justify-between py-2 px-1">
            {/* Attachment button */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={isLoading}
              className="flex items-center gap-1 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              title="Attach files"
            >
              <Paperclip className="size-4" />
            </button>

            <Button
              onClick={handleSendMessage}
              disabled={
                (!inputValue.trim() && attachments.length === 0) || isLoading
              }
              size="icon"
              className="rounded-full"
            >
              <Send className="size-4" />
            </Button>
          </div>
        </div>
      </div>
    </>
  );
}
