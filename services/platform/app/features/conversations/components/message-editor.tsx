'use client';

import { useState, useEffect, useRef, useTransition } from 'react';
import {
  PaperclipIcon,
  XIcon,
  FileIcon,
  ImageIcon,
  VideoIcon,
  MusicIcon,
  WandSparklesIcon,
  ChevronLeft,
  LoaderIcon,
  LoaderCircleIcon,
} from 'lucide-react';
import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { Send } from 'lucide-react';
import { Button } from '@/app/components/ui/primitives/button';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { cn } from '@/lib/utils/cn';
import {
  TooltipProvider,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/app/components/ui/overlays/tooltip';
import { toast } from '@/app/hooks/use-toast';
import type { Message as ConversationMessage } from '../types';
import { Crepe } from '@milkdown/crepe';
import type { CrepeBuilder } from '@milkdown/crepe/builder';
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from '@milkdown/react';
import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { useT } from '@/lib/i18n/client';

// Markdown -> HTML conversion using existing deps
import ReactMarkdown from 'react-markdown';
import { renderToStaticMarkup } from 'react-dom/server';
import DOMPurify from 'dompurify';

// AI improvement
import { improveMessage } from '../actions/improve-message';
import { MessageImprovementDialog } from './message-improvement-dialog';

interface AttachedFile {
  id: string;
  file: File | null;
  type: 'image' | 'video' | 'audio' | 'document';
}

interface MessageEditorProps {
  placeholder?: string;
  disabled?: boolean;
  onSave?: (
    message: string,
    attachments?: AttachedFile[],
  ) => void | Promise<void>;
  messageId?: string;
  businessId?: string;
  conversationId?: string;
  onConversationResolved?: () => void;
  pendingMessage?: Pick<ConversationMessage, 'id' | 'content'>;
  hasMessageHistory?: boolean;
}

// Helper function to determine file type
const getFileType = (file: File): AttachedFile['type'] => {
  if (file.type.startsWith('image/')) return 'image';
  if (file.type.startsWith('video/')) return 'video';
  if (file.type.startsWith('audio/')) return 'audio';
  return 'document';
};

// Helper function to get file icon
const getFileIcon = (type: AttachedFile['type'], size = 'size-4') => {
  switch (type) {
    case 'image':
      return <ImageIcon className={`${size} text-blue-500`} />;
    case 'video':
      return <VideoIcon className={`${size} text-purple-500`} />;
    case 'audio':
      return <MusicIcon className={`${size} text-green-500`} />;
    case 'document':
      return <FileIcon className={`${size} text-muted-foreground`} />;
    default:
      return <FileIcon className={`${size} text-muted-foreground`} />;
  }
};

// Inner editor component that has access to Milkdown instance
function MilkdownEditorInner({
  placeholder,
  disabled = false,
  onSave,
  messageId,
  conversationId: _conversationId,
  onConversationResolved: _onConversationResolved,
  pendingMessage,
  hasMessageHistory = false,
}: MessageEditorProps) {
  // Translations
  const { t: tConversations } = useT('conversations');
  const { t: tCommon } = useT('common');

  // Helper function to format file size
  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return `0 ${tCommon('fileSize.bytes')}`;
    const k = 1024;
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    const units = [
      tCommon('fileSize.bytes'),
      tCommon('fileSize.kb'),
      tCommon('fileSize.mb'),
      tCommon('fileSize.gb'),
    ];
    return `${Number.parseFloat((bytes / Math.pow(k, i)).toFixed(2))} ${units[i]}`;
  };

  // Use placeholder from props or fallback to translation
  const editorPlaceholder = placeholder || tConversations('messagePlaceholder');
  const [message, setMessage] = usePersistedState(
    messageId ? `conversation-${messageId}` : 'new-conversation',
    pendingMessage?.content || '',
  );
  const [improveInstruction, setImproveInstruction] = usePersistedState(
    messageId
      ? `conversation-${messageId}-improve-instruction`
      : 'new-conversation-improve-instruction',
    '',
  );

  const [attachedFiles, setAttachedFiles] = useState<AttachedFile[]>([]);
  const [isImproveMode, setIsImproveMode] = useState(false);
  const [isImproving, startImprovingTransition] = useTransition();
  const [isSending, startSendingTransition] = useTransition();
  const [isFocused, setIsFocused] = useState(false);

  // Initialize hasContent based only on pendingMessage; editor updates will keep it in sync
  const initialHasContent = (pendingMessage?.content?.trim().length ?? 0) > 0;
  const [hasContent, setHasContent] = useState(initialHasContent);

  const [savedEditorContent, setSavedEditorContent] = useState<string>('');
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [improvedContent, setImprovedContent] = useState('');
  // Track programmatic content updates (separate from user edits)
  const [programmaticContent, setProgrammaticContent] = useState<string | null>(
    null,
  );

  const fileInputRef = useRef<HTMLInputElement>(null);
  const improveInputRef = useRef<HTMLTextAreaElement>(null);

  // Hold a reference to the Crepe instance
  const crepeRef = useRef<Crepe | null>(null);

  // Initialize Milkdown editor with Crepe and subscribe to updates
  useEditor(
    (root) => {
      // Use programmatic content if available, otherwise use persisted message
      const defaultValue =
        programmaticContent ?? (message || (pendingMessage?.content ?? ''));

      const editor = new Crepe({
        root,
        defaultValue,
        featureConfigs: {
          [Crepe.Feature.Placeholder]: {
            text: editorPlaceholder,
          },
        },
      });

      // Store instance for later use (reading content on send, etc.)
      crepeRef.current = editor;

      // Listen to editor updates & focus/blur via Milkdown listener API
      editor.on((listener) => {
        // Update local state whenever markdown changes
        listener.markdownUpdated((_ctx, markdown) => {
          setMessage(markdown);
          setHasContent(markdown.trim().length > 0);
        });
        // Track focus/blur for height behavior
        listener.focus(() => setIsFocused(true));
        listener.blur(() => setIsFocused(false));
      });

      // Cast to CrepeBuilder to satisfy useEditor's GetEditor type
      // Crepe extends CrepeBuilder, but TypeScript's private field checking
      // can cause compatibility issues in some build environments
      return editor as CrepeBuilder;
    },
    [programmaticContent],
  ); // Reinitialize when programmatic content changes

  const [isLoading] = useInstance();

  // Clear programmatic content after editor initializes with it
  // This prevents re-initialization on subsequent user edits
  useEffect(() => {
    if (programmaticContent !== null && !isLoading) {
      setProgrammaticContent(null);
    }
  }, [programmaticContent, isLoading]);

  // If we have a pending message and the internal state is still empty,
  // initialize the message state so Send/Improve actions work.
  useEffect(() => {
    const pending = pendingMessage?.content ?? '';
    if (!message.trim() && pending.trim()) {
      setMessage(pending);
      setHasContent(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- setMessage is stable, setHasContent is intentionally excluded
  }, [pendingMessage, message]);

  // Focus improve input when improve mode is activated
  useEffect(() => {
    if (isImproveMode && improveInputRef.current) {
      const textarea = improveInputRef.current;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, [isImproveMode]);

  // Convert Markdown to sanitized HTML for email sending
  const markdownToHtml = (md: string): string => {
    const src = md.trim();
    if (!src) return '';
    const raw = renderToStaticMarkup(
      <ReactMarkdown
        components={{
          a: ({ node: _node, ...props }) => (
            <a {...props} target="_blank" rel="noopener noreferrer" />
          ),
        }}
      >
        {src}
      </ReactMarkdown>,
    );
    const sanitized = DOMPurify.sanitize(raw);
    return sanitized;
  };

  const handleOpenInstructionTextarea = () => {
    // Save current message content from state
    setSavedEditorContent(message);
    setIsImproveMode(true);
  };

  const handleImproveSubmit = async () => {
    // Use the message state instead of calling crepe.getMarkdown()
    const currentMarkdown = savedEditorContent || message;

    if (!currentMarkdown.trim()) {
      toast({
        title: tConversations('editor.noContent'),
        variant: 'destructive',
      });
      return;
    }

    startImprovingTransition(async () => {
      try {
        const result = await improveMessage(
          currentMarkdown,
          improveInstruction.trim() || undefined,
        );

        if (result.error) {
          toast({
            title: result.error,
            variant: 'destructive',
          });
          return;
        }

        setImprovedContent(result.improvedMessage);
        setShowPreviewDialog(true);
        setIsImproveMode(false);
      } catch (error) {
        console.error('Failed to improve content:', error);
        toast({
          title: tConversations('editor.improveFailed'),
          variant: 'destructive',
        });
      }
    });
  };

  const handleAcceptImprovement = () => {
    if (improvedContent) {
      // Update the persisted message state (for localStorage persistence)
      setMessage(improvedContent);
      // Set programmatic content - this triggers useEditor to reinitialize
      // This is necessary because Crepe only has getMarkdown(), not setMarkdown()
      setProgrammaticContent(improvedContent);
    }
    setShowPreviewDialog(false);
    setImproveInstruction('');
  };

  const handleRejectImprovement = () => {
    setShowPreviewDialog(false);
    setImprovedContent('');
  };

  const handleSendMessage = async () => {
    // Use message state instead of crepe.getMarkdown()
    const markdown = message || '';
    const html = markdownToHtml(markdown);

    if ((html.trim() || attachedFiles.length > 0) && onSave) {
      startSendingTransition(async () => {
        try {
          // Save the HTML message (conversation-panel will pass it as html and derive text)
          await onSave(html, attachedFiles);

          // Only clear after successful send to preserve content on error
          setAttachedFiles([]);
          setMessage('');
          setProgrammaticContent('');
          setIsImproveMode(false);
          setImproveInstruction('');
        } catch (error) {
          // Content is preserved - user can retry sending
          console.error('Failed to send message:', error);
          toast({
            title: tConversations('editor.sendFailed'),
            variant: 'destructive',
          });
        }
      });
    }
  };

  // Handle file input click
  const handleFileInputClick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  // Handle file selection
  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      const attachedFile: AttachedFile = {
        id: Date.now().toString() + Math.random().toString(36).substring(2, 11),
        file,
        type: getFileType(file),
      };
      setAttachedFiles((prev) => [...prev, attachedFile]);
    }
    event.target.value = '';
  };

  // Handle file removal
  const handleRemoveFile = (fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  };

  // Determine the height state
  // Dynamic height system with 5 distinct states:
  // 1. Empty & Unfocused: 3rem (48px) - Compact when empty
  // 2. Content & Unfocused (with history): 7rem (112px) - Medium height with content
  // 3. Content & Unfocused (no history): 32rem (512px) - Full height for first message
  // 4. Focused: 32rem (512px) - Expands significantly when user clicks in
  // 5. Improve Mode: Auto height - Auto height for improvement textarea
  const getHeightClass = () => {
    if (isImproveMode) {
      return 'h-auto';
    }

    if (isFocused) {
      return 'h-[20rem]';
    }

    if (hasContent) {
      if (hasMessageHistory) {
        return 'h-[7rem]';
      } else {
        return 'h-[20rem]';
      }
    }

    return 'h-[3rem]';
  };

  return (
    <div className="border-muted rounded-t-3xl border-[0.5rem] border-b-0 mx-2">
      <div className="bg-background rounded-t-[0.875rem] relative px-3 pt-1 border border-muted-foreground/50 border-b-0">
        {/* Editor Container */}
        <div
          className={cn(
            'transition-all duration-300 ease-in-out overflow-y-auto',
            getHeightClass(),
          )}
        >
          {isImproveMode && !isImproving && (
            <div className="flex items-start gap-2 p-2">
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={() => {
                        setIsImproveMode(false);
                        setImproveInstruction('');
                      }}
                      variant="ghost"
                      size="icon"
                    >
                      <ChevronLeft className="size-4" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {tConversations('editor.backToEditor')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
              <Textarea
                ref={improveInputRef}
                value={improveInstruction}
                onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
                  setImproveInstruction(e.target.value);
                }}
                placeholder={tConversations('suggestEditsPlaceholder')}
                className="flex-1 resize-none border-0 outline-none bg-transparent p-2 focus-visible:ring-0 focus-visible:ring-offset-0 text-sm text-muted-foreground h-auto min-h-[10rem]"
                onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
                  if (
                    e.key === 'Enter' &&
                    !e.shiftKey &&
                    improveInstruction.trim() &&
                    !isImproving
                  ) {
                    e.preventDefault();
                    handleImproveSubmit();
                  }
                }}
              />
            </div>
          )}
          {/* Main editor: always mounted, hidden when in improve/improving mode */}
          <div
            className={cn(
              'h-full transition-opacity duration-300',
              isSending && 'opacity-50 pointer-events-none',
              (isImproveMode || isImproving) && 'hidden',
            )}
          >
            <style jsx global>{`
              .milkdown {
                .milkdown-block-handle {
                  display: none !important;
                }
                .ProseMirror {
                  h1:first-of-type {
                    margin-top: 1rem;
                  }
                  h1 {
                    margin-bottom: 0.5rem;
                    font-size: 1.5rem;
                    line-height: 1.2;
                  }
                  p {
                    font-size: 0.875rem;
                    line-height: 1.5;
                  }
                }
                height: 100%;
                display: flex;
                flex-direction: column;
                --crepe-color-background: transparent;
                --crepe-color-on-background: hsl(var(--foreground));
                --crepe-color-surface: hsl(var(--background));
                --crepe-color-surface-low: hsl(var(--secondary));
                --crepe-color-on-surface: hsl(var(--foreground));
                --crepe-color-on-surface-variant: hsl(
                  var(--secondary-foreground)
                );
                --crepe-color-outline: #a8a8a8;
                --crepe-color-primary: hsl(var(--primary));
                --crepe-color-secondary: hsl(var(--secondary));
                --crepe-color-on-secondary: hsl(var(--foreground));
                --crepe-color-inverse: hsl(var(--background));
                --crepe-color-on-inverse: hsl(var(--foreground));
                --crepe-color-inline-code: hsl(var(--destructive));
                --crepe-color-error: hsl(var(--destructive));
                --crepe-color-hover: hsl(var(--muted));
                --crepe-color-selected: #d5d5d5;
                --crepe-color-inline-area: hsl(var(--muted));
                --crepe-font-title: var(--font-inter);
                --crepe-font-default: var(--font-inter);
              }
              .milkdown .editor {
                flex: 1;
                overflow-y: auto;
                padding: 0.5rem;
              }
              .milkdown .ProseMirror {
                height: 100%;
                outline: none;
              }
              .milkdown .ProseMirror p {
                margin: 0;
                min-height: 1rem;
              }
            `}</style>
            <Milkdown />
          </div>

          {/* Loading state during improvement */}
          {isImproving && (
            <div className="flex items-center justify-center h-full pt-12 pb-4">
              <LoaderIcon className="size-6 animate-spin text-muted-foreground" />
              <span className="ml-2 text-sm text-muted-foreground">
                {tConversations('editor.improving')}
              </span>
            </div>
          )}
        </div>

        {/* File attachments */}
        {attachedFiles.length > 0 && (
          <div className="py-2 border-t border-border">
            <div className="flex flex-wrap gap-2">
              {attachedFiles.map((file) => (
                <div
                  key={file.id}
                  className="flex items-center gap-2 bg-muted rounded-md px-3 py-2 text-sm"
                >
                  {getFileIcon(file.type)}
                  <span className="max-w-[200px] truncate">
                    {file.file?.name}
                  </span>
                  <span className="text-muted-foreground text-xs">
                    {file.file && formatFileSize(file.file.size)}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRemoveFile(file.id)}
                    className="ml-1 hover:bg-background rounded p-0.5"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex items-center justify-between py-2">
          {!isImproveMode && (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                onChange={handleFileChange}
                disabled={disabled || isSending}
              />
              <Button
                onClick={handleFileInputClick}
                disabled={disabled || isSending}
                variant="ghost"
                size="icon"
              >
                <PaperclipIcon className="size-4" />
              </Button>
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={handleOpenInstructionTextarea}
                      disabled={
                        disabled ||
                        isLoading ||
                        !hasContent ||
                        isImproving ||
                        isSending
                      }
                      variant="ghost"
                      size="icon"
                    >
                      {isImproving ? (
                        <LoaderCircleIcon className="size-4 animate-spin text-muted-foreground" />
                      ) : (
                        <WandSparklesIcon className="size-4" />
                      )}
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>
                    {tConversations('editor.improveWithAi')}
                  </TooltipContent>
                </Tooltip>
              </TooltipProvider>
            </div>
          )}
          {isImproveMode && <div />}

          {!isImproveMode && (
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={
                disabled ||
                isLoading ||
                (!hasContent && attachedFiles.length === 0) ||
                isImproving ||
                isSending
              }
              className="rounded-full"
            >
              {isSending ? (
                <LoaderCircleIcon className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          )}
          {isImproveMode && (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={handleImproveSubmit}
                    size="icon"
                    disabled={isImproving}
                    className="rounded-full"
                  >
                    {isImproving ? (
                      <LoaderCircleIcon className="size-4 animate-spin" />
                    ) : (
                      <WandSparklesIcon className="size-4" />
                    )}
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  {isImproving
                    ? tConversations('editor.improving')
                    : tConversations('editor.generateImprovement')}
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )}
        </div>
      </div>

      <MessageImprovementDialog
        isOpen={showPreviewDialog}
        onClose={handleRejectImprovement}
        onAccept={handleAcceptImprovement}
        originalMessage={savedEditorContent}
        improvedMessage={improvedContent}
      />
    </div>
  );
}

// Main editor component with Milkdown provider
export function MessageEditor(props: MessageEditorProps) {
  return (
    <MilkdownProvider>
      <MilkdownEditorInner {...props} />
    </MilkdownProvider>
  );
}
