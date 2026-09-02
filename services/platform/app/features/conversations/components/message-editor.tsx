'use client';

import { Crepe } from '@milkdown/crepe';
import { getHTML } from '@milkdown/kit/utils';
import {
  Milkdown,
  MilkdownProvider,
  useEditor,
  useInstance,
} from '@milkdown/react';
import { Row } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { LoaderIcon } from 'lucide-react';
import { useState, useEffect, useRef, useCallback, useTransition } from 'react';

import { usePersistedState } from '@/app/hooks/use-persisted-state';
import { useAuth } from '@/app/hooks/use-session-user';
import { toast } from '@/app/hooks/use-toast';
import { useT } from '@/lib/i18n/client';

import '@milkdown/crepe/theme/common/style.css';
import '@milkdown/crepe/theme/frame.css';
import { cn } from '@/lib/utils/cn';

import { useImproveMessage } from '../hooks/actions';
import { EditorActionBar } from './message-editor/editor-action-bar';
import { FileAttachmentsList } from './message-editor/file-attachments-list';
import { ImproveMode } from './message-editor/improve-mode';
import { toOutboundHtml } from './message-editor/outbound-html';
import {
  type AttachedFile,
  type MessageEditorProps,
  messageDraftKeys,
} from './message-editor/types';
import { MessageImprovementDialog } from './message-improvement-dialog';

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
  organizationId,
}: MilkdownEditorInnerProps) {
  const { t: tConversations } = useT('conversations');
  const { user } = useAuth();

  const { mutateAsync: improveMessage } = useImproveMessage();

  const editorPlaceholder = placeholder || tConversations('messagePlaceholder');
  const draftKeys = messageDraftKeys(user?.userId, messageId);
  // Empty string — never `pendingMessage.content`. `clear()` resets to this
  // initial value; tying it to the undo draft would put the draft back on clear.
  const [message, setMessage, clearMessage] = usePersistedState(
    draftKeys.body,
    '',
  );
  const [improveInstruction, setImproveInstruction, clearImproveInstruction] =
    usePersistedState(draftKeys.improveInstruction, '');

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
  // Seed from pending only when the pending payload changes — not when the
  // body is cleared after send (that used to re-write the undo draft into
  // localStorage right before remount).
  const appliedPendingKeyRef = useRef<string | null>(null);

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

      return editor;
    },
    [programmaticContent],
  );

  const [isLoading] = useInstance();

  useEffect(() => {
    if (programmaticContent !== null && !isLoading) {
      setProgrammaticContent(null);
    }
  }, [programmaticContent, isLoading]);

  const pendingId = pendingMessage?.id;
  const pendingContent = pendingMessage?.content ?? '';

  useEffect(() => {
    if (!pendingContent.trim()) {
      appliedPendingKeyRef.current = null;
      return;
    }
    const applyKey = `${pendingId ?? ''}:${pendingContent}`;
    if (appliedPendingKeyRef.current === applyKey) return;
    appliedPendingKeyRef.current = applyKey;
    setMessage(pendingContent);
    setProgrammaticContent(pendingContent);
    setHasContent(true);
  }, [pendingId, pendingContent, setMessage]);

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
          organizationId,
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
    organizationId,
    tConversations,
  ]);

  const handleAcceptImprovement = useCallback(() => {
    if (improvedContent) {
      setMessage(improvedContent);
      setProgrammaticContent(improvedContent);
    }
    setShowPreviewDialog(false);
    setImproveInstruction('');
    toast({
      title: tConversations('editor.replyImproved'),
      variant: 'success',
    });
  }, [improvedContent, setMessage, setImproveInstruction, tConversations]);

  const handleRejectImprovement = useCallback(() => {
    setShowPreviewDialog(false);
    setImprovedContent('');
  }, []);

  const handleSendMessage = useCallback(async () => {
    // Serialize the live editor document through its own schema (getHTML) so
    // the sent HTML is exactly what the editor displayed. Re-rendering the
    // markdown state through a second renderer disagreed with the editor —
    // e.g. Milkdown serializes empty paragraphs as raw `<br />` markdown,
    // which shipped as literal "<br />" text. The markdown state still gates
    // emptiness: an empty document serializes to `<p></p>`, which would
    // otherwise read as a non-empty body.
    const hasBody = message.trim().length > 0;
    const editorHtml =
      hasBody && crepeRef.current
        ? crepeRef.current.editor.action(getHTML())
        : '';
    const html = editorHtml ? toOutboundHtml(editorHtml) : '';

    if ((html.trim() || attachedFiles.length > 0) && onSave) {
      startSendingTransition(async () => {
        try {
          await onSave(html, attachedFiles, hasBody ? message : undefined);

          setAttachedFiles([]);
          setIsImproveMode(false);
          setHasContent(false);
          clearMessage();
          clearImproveInstruction();

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
    clearMessage,
    clearImproveInstruction,
    onMessageSent,
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
    return 'h-[5rem]';
  };

  return (
    <>
      <div className="bg-background relative rounded-xl border border-gray-300 px-3.5 pt-2.5 pb-1 shadow-sm">
        <div
          className={cn(
            'overflow-y-auto transition-all duration-300 ease-in-out',
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
              isSending && 'pointer-events-none opacity-50',
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
            <Row gap={0} justify="center" className="h-full pt-12 pb-4">
              <LoaderIcon className="text-muted-foreground size-6 animate-spin" />
              <Text as="span" variant="muted" className="ml-2">
                {tConversations('editor.improving')}
              </Text>
            </Row>
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
    </>
  );
}

export function MessageEditor(props: MessageEditorProps) {
  const [editorKey, setEditorKey] = useState(0);
  const { onPendingMessageConsumed } = props;

  const handleMessageSent = useCallback(() => {
    // Clear the undo seed in the same synchronous turn as the remount so
    // React batches them: the new editor mounts without `pendingMessage`.
    onPendingMessageConsumed?.();
    setEditorKey((k) => k + 1);
  }, [onPendingMessageConsumed]);

  return (
    <MilkdownProvider key={editorKey}>
      <MilkdownEditorInner {...props} onMessageSent={handleMessageSent} />
    </MilkdownProvider>
  );
}
