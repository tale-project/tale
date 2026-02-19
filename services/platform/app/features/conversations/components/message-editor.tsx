'use client';

import type { CrepeBuilder } from '@milkdown/crepe/builder';

import { Crepe } from '@milkdown/crepe';
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from '@milkdown/react';
import DOMPurify from 'dompurify';
import { LoaderIcon } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useTransition } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import ReactMarkdown from 'react-markdown';

import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import type { AttachedFile, MessageEditorProps } from './message-editor/types';

import { useImproveMessage } from '../hooks/actions';
import { EditorActionBar } from './message-editor/editor-action-bar';
import { FileAttachmentsList } from './message-editor/file-attachments-list';
import { ImproveMode } from './message-editor/improve-mode';
import { MessageImprovementDialog } from './message-improvement-dialog';

function markdownToHtml(md: string): string {
  const src = md.trim();
  if (!src) return '';
  const raw = renderToStaticMarkup(
    <ReactMarkdown
      components={{
        a: ({ href, children }) => (
          <a href={href} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        ),
      }}
    >
      {src}
    </ReactMarkdown>,
  );
  return DOMPurify.sanitize(raw);
}

interface MilkdownEditorInnerProps extends MessageEditorProps {
  onMessageSent?: () => void;
}

function MilkdownEditorInner({
  placeholder,
  disabled = false,
  onSave,
  messageId,
  conversationId: _conversationId,
  onConversationResolved: _onConversationResolved,
  pendingMessage,
  hasMessageHistory = false,
  onMessageSent,
}: MilkdownEditorInnerProps) {
  const { t: tConversations } = useT('conversations');

  const { mutateAsync: improveMessage } = useImproveMessage();

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

  const initialHasContent = (pendingMessage?.content?.trim().length ?? 0) > 0;
  const [hasContent, setHasContent] = useState(initialHasContent);

  const [savedEditorContent, setSavedEditorContent] = useState('');
  const [showPreviewDialog, setShowPreviewDialog] = useState(false);
  const [improvedContent, setImprovedContent] = useState('');
  const [programmaticContent, setProgrammaticContent] = useState<string | null>(
    null,
  );

  const crepeRef = useRef<Crepe | null>(null);

  useEditor(
    (root) => {
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

      crepeRef.current = editor;

      editor.on((listener) => {
        listener.markdownUpdated((_ctx, markdown) => {
          setMessage(markdown);
          setHasContent(markdown.trim().length > 0);
        });
        listener.focus(() => setIsFocused(true));
        listener.blur(() => setIsFocused(false));
      });

      // Crepe extends CrepeBuilder, but TypeScript's private field checking
      // can cause compatibility issues in some build environments
      return editor as CrepeBuilder;
    },
    [programmaticContent],
  );

  const [isLoading] = useInstance();

  useEffect(() => {
    if (programmaticContent !== null && !isLoading) {
      setProgrammaticContent(null);
    }
  }, [programmaticContent, isLoading]);

  useEffect(() => {
    const pending = pendingMessage?.content ?? '';
    if (!message.trim() && pending.trim()) {
      setMessage(pending);
      setProgrammaticContent(pending);
      setHasContent(true);
    }
  }, [pendingMessage, message, setMessage]);

  const handleOpenInstructionTextarea = useCallback(() => {
    setSavedEditorContent(message);
    setIsImproveMode(true);
  }, [message]);

  const handleImproveSubmit = useCallback(async () => {
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
        const result = await improveMessage({
          originalMessage: currentMarkdown,
          instruction: improveInstruction.trim() || undefined,
        });

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
  }, [
    savedEditorContent,
    message,
    improveInstruction,
    improveMessage,
    tConversations,
  ]);

  const handleAcceptImprovement = useCallback(() => {
    if (improvedContent) {
      setMessage(improvedContent);
      setProgrammaticContent(improvedContent);
    }
    setShowPreviewDialog(false);
    setImproveInstruction('');
  }, [improvedContent, setMessage, setImproveInstruction]);

  const handleRejectImprovement = useCallback(() => {
    setShowPreviewDialog(false);
    setImprovedContent('');
  }, []);

  const handleSendMessage = useCallback(async () => {
    const markdown = message || '';
    const html = markdownToHtml(markdown);

    if ((html.trim() || attachedFiles.length > 0) && onSave) {
      startSendingTransition(async () => {
        try {
          await onSave(html, attachedFiles);

          setAttachedFiles([]);
          setIsImproveMode(false);
          setImproveInstruction('');
          setHasContent(false);

          const storageKey = messageId
            ? `conversation-${messageId}`
            : 'new-conversation';
          window.localStorage.removeItem(storageKey);

          onMessageSent?.();
        } catch (error) {
          console.error('Failed to send message:', error);
          toast({
            title: tConversations('editor.sendFailed'),
            variant: 'destructive',
          });
        }
      });
    }
  }, [
    message,
    attachedFiles,
    onSave,
    messageId,
    onMessageSent,
    setImproveInstruction,
    tConversations,
  ]);

  const handleFileAttach = useCallback((file: AttachedFile) => {
    setAttachedFiles((prev) => [...prev, file]);
  }, []);

  const handleRemoveFile = useCallback((fileId: string) => {
    setAttachedFiles((prev) => prev.filter((f) => f.id !== fileId));
  }, []);

  const handleCloseImproveMode = useCallback(() => {
    setIsImproveMode(false);
    setImproveInstruction('');
  }, [setImproveInstruction]);

  const getHeightClass = () => {
    if (isImproveMode) return 'h-auto';
    if (isFocused) return 'h-[20rem]';
    if (hasContent) {
      return hasMessageHistory ? 'h-[7rem]' : 'h-[20rem]';
    }
    return 'h-[3rem]';
  };

  return (
    <div className="border-muted mx-2 rounded-t-3xl border-[0.5rem] border-b-0">
      <div className="bg-background border-muted-foreground/50 relative rounded-t-[0.875rem] border border-b-0 px-3 pt-1">
        <div
          className={cn(
            'transition-all duration-300 ease-in-out overflow-y-auto',
            getHeightClass(),
          )}
        >
          {isImproveMode && !isImproving && (
            <ImproveMode
              instruction={improveInstruction}
              isImproving={isImproving}
              onInstructionChange={setImproveInstruction}
              onClose={handleCloseImproveMode}
              onSubmit={handleImproveSubmit}
            />
          )}

          <div
            className={cn(
              'h-full transition-opacity duration-300',
              isSending && 'opacity-50 pointer-events-none',
              (isImproveMode || isImproving) && 'hidden',
            )}
          >
            <style>{`
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

          {isImproving && (
            <div className="flex h-full items-center justify-center pt-12 pb-4">
              <LoaderIcon className="text-muted-foreground size-6 animate-spin" />
              <span className="text-muted-foreground ml-2 text-sm">
                {tConversations('editor.improving')}
              </span>
            </div>
          )}
        </div>

        <FileAttachmentsList
          files={attachedFiles}
          onRemove={handleRemoveFile}
        />

        <EditorActionBar
          disabled={disabled}
          isLoading={isLoading}
          isImproveMode={isImproveMode}
          isImproving={isImproving}
          isSending={isSending}
          hasContent={hasContent}
          attachedFiles={attachedFiles}
          onFileAttach={handleFileAttach}
          onImproveOpen={handleOpenInstructionTextarea}
          onImproveSubmit={handleImproveSubmit}
          onSend={handleSendMessage}
        />
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

export function MessageEditor(props: MessageEditorProps) {
  const [editorKey, setEditorKey] = useState(0);

  const handleMessageSent = useCallback(() => {
    setEditorKey((k) => k + 1);
  }, []);

  return (
    <MilkdownProvider key={editorKey}>
      <MilkdownEditorInner {...props} onMessageSent={handleMessageSent} />
    </MilkdownProvider>
  );
}
