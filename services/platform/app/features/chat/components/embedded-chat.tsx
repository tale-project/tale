'use client';

/**
 * A self-contained embeddable chat panel — the generic form of the workflow
 * assistant's composition. Encapsulates the FULL provider stack the chat
 * pipeline needs (`ChatLayoutProvider` → `FileUpload.Root` → `BranchProvider`
 * → `ThreadMessageMetadataProvider`) so a host mounts ONE component anywhere
 * (an app view block, a detail overlay) and gets the main-chat rendering stack
 * (`ChatMessages`/`MessageBubble` + approvals) and composer (`ChatInput`,
 * assistant variant) against a caller-pinned agent.
 *
 * Scroll is panel-scoped (follow-the-bottom); the HOST controls the panel's
 * height by sizing the flex container this fills (`className`/wrapper).
 *
 * Stop button: intentionally NOT wired (`onStopGenerating` unset), so
 * `ChatInput` renders its Stop affordance disabled while a turn generates —
 * the exact behavior of the workflow-assistant precedent. Rationale: the
 * embed also serves SHARED `automation_discussion` threads where the backend Stop
 * (`threads/mutations:cancelGeneration`) is creator-only; wiring Stop would
 * either break for non-owners or require widening that ownership check (any
 * member could then truncate another member's in-flight reply). Sending a new
 * message still supersedes an in-flight turn for every authorized member —
 * `chat_turn` cancels as the thread owner on the supersede path.
 */
import { Stack } from '@tale/ui/layout';
import { useEffect, useRef } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { ChatInput } from '@/app/features/chat/components/chat-input';
import { ChatMessages } from '@/app/features/chat/components/chat-messages';
import { BranchProvider } from '@/app/features/chat/context/branch-context';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';
import { ThreadMessageMetadataProvider } from '@/app/features/chat/hooks/queries';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useEmbeddedChat } from '../hooks/use-embedded-chat';

export interface EmbeddedChatProps {
  organizationId: string;
  /** The agent answering every turn — pinned, never routed. */
  agentSlug: string;
  /** Pre-resolved thread for history; `null`/absent until one exists. */
  threadId?: string | null;
  /**
   * Idempotent thread acquisition, called once on the first send. Must be
   * referentially stable (`useCallback`) — it anchors the send handler.
   */
  resolveThread: () => Promise<string>;
  /** Extra key/value context injected into every turn's prompt. */
  additionalContext?: Record<string, string>;
  /** Composer placeholder; defaults to ChatInput's own. */
  placeholder?: string;
  /** Composer variant; only the compact panel form is supported today. */
  variant?: 'assistant';
  /** Merged onto the panel's root (host-controlled sizing). */
  className?: string;
}

function EmbeddedChatContent({
  organizationId,
  agentSlug,
  threadId: knownThreadId,
  resolveThread,
  additionalContext,
  placeholder,
  variant = 'assistant',
  className,
}: EmbeddedChatProps) {
  const { t: tChat } = useT('chat');

  const {
    threadId,
    items,
    activeApproval,
    activeApprovalInline,
    loadMore,
    canLoadMore,
    isLoadingMore,
    isLoading,
    isSendPending,
    inputValue,
    setInputValue,
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
    isIndexing,
    indexingStatuses,
    isTranscribing,
    transcriptionStatuses,
    handleSendMessage,
  } = useEmbeddedChat({
    organizationId,
    agentSlug,
    threadId: knownThreadId,
    resolveThread,
    additionalContext,
    errorMessageText: tChat('toast.sendFailed'),
    // The message substituted for an attachments-only send (same semantics as
    // the workflow assistant's, owned by the chat namespace).
    analyzeAttachmentsText: tChat('embedded.analyzeAttachments'),
  });

  const containerRef = useRef<HTMLDivElement>(null);
  const lastUserMessageRef = useRef<HTMLDivElement>(null);

  // Keep the panel pinned to the conversation tail as new turns arrive (the
  // chat page's full scroll machine is page-scoped; the panel only needs
  // follow-the-bottom).
  const itemCount = items.length;
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [itemCount, isLoading]);

  return (
    <Stack gap={0} className={cn('relative min-h-0 flex-1', className)}>
      <Stack
        ref={containerRef}
        gap={0}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {/* The SAME rendering stack as the chat page: ChatMessages →
            MessageBubble (markdown, thought timeline, attachments) +
            ApprovalCardRenderer for approval cards. BranchProvider satisfies
            ChatMessages' branch context; the panel offers no fork/edit
            affordances so navigators stay hidden. */}
        <BranchProvider
          threadId={threadId ?? undefined}
          organizationId={organizationId}
        >
          <ThreadMessageMetadataProvider threadId={threadId}>
            <ChatMessages
              items={items}
              threadId={threadId ?? undefined}
              organizationId={organizationId}
              canLoadMore={canLoadMore}
              isLoadingMore={isLoadingMore}
              loadMore={loadMore}
              isLoading={isLoading}
              isSendPending={isSendPending}
              lastUserMessageRef={lastUserMessageRef}
              containerRef={containerRef}
              activeApproval={activeApproval}
              activeApprovalInline={activeApprovalInline}
              onSendFollowUp={(message) => void handleSendMessage(message)}
              onSendMessage={(message) => void handleSendMessage(message)}
              hideBranchNavigator
            />
          </ThreadMessageMetadataProvider>
        </BranchProvider>
      </Stack>

      <ChatInput
        className="p-2"
        variant={variant}
        placeholder={placeholder}
        value={inputValue}
        onChange={setInputValue}
        onSendMessage={(message, sentAttachments) =>
          void handleSendMessage(message, sentAttachments)
        }
        isLoading={isLoading}
        organizationId={organizationId}
        attachments={attachments}
        uploadingFiles={uploadingFiles}
        uploadFiles={uploadFiles}
        removeAttachment={removeAttachment}
        clearAttachments={clearAttachments}
        isIndexing={isIndexing}
        indexingStatuses={indexingStatuses}
        isTranscribing={isTranscribing}
        transcriptionStatuses={transcriptionStatuses}
      />
    </Stack>
  );
}

export function EmbeddedChat(props: EmbeddedChatProps) {
  // The panel reuses the chat composer (`ChatInput`) and its sub-controls,
  // the pending-message channel (`usePendingMessages`), and the message stack
  // (`ChatMessages`), all of which read `useChatLayout`. Provide the context
  // here so the panel works standalone anywhere in the product (it isn't
  // under the chat page's provider). Keyed by org, same as chat.
  return (
    <ChatLayoutProvider organizationId={props.organizationId}>
      <FileUpload.Root>
        <EmbeddedChatContent {...props} />
      </FileUpload.Root>
    </ChatLayoutProvider>
  );
}
