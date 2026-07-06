'use client';

import { Stack } from '@tale/ui/layout';
import { useEffect, useRef } from 'react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { ChatInput } from '@/app/features/chat/components/chat-input';
import { ChatMessages } from '@/app/features/chat/components/chat-messages';
import { BranchProvider } from '@/app/features/chat/context/branch-context';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';
import { ThreadMessageMetadataProvider } from '@/app/features/chat/hooks/queries';
import { useT } from '@/lib/i18n/client';

import { useAssistantChat } from '../hooks/use-assistant-chat';

interface AutomationAssistantProps {
  workflowSlug?: string;
  workflowName?: string;
  organizationId: string;
}

function AutomationAssistantContent({
  workflowSlug,
  workflowName,
  organizationId,
}: AutomationAssistantProps) {
  const { t } = useT('automations');

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
    generationStartMs,
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
  } = useAssistantChat({
    workflowSlug,
    workflowName,
    organizationId,
    errorMessageText: t('assistant.errorMessage'),
    analyzeAttachmentsText: t('assistant.analyzeAttachments'),
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
    <Stack gap={0} className="relative min-h-0 flex-1">
      <Stack
        ref={containerRef}
        gap={0}
        className="min-h-0 flex-1 overflow-y-auto px-3 py-2"
      >
        {/* The SAME rendering stack as the chat page: ChatMessages →
            MessageBubble (markdown, thought timeline, attachments) +
            ApprovalCardRenderer for workflow approval cards. BranchProvider
            satisfies ChatMessages' branch context; the panel offers no
            fork/edit affordances so navigators stay hidden. */}
        <BranchProvider
          threadId={threadId ?? undefined}
          organizationId={organizationId}
        >
          <ThreadMessageMetadataProvider
            threadId={threadId}
            generationStartMs={generationStartMs}
          >
            <ChatMessages
              items={items}
              threadId={threadId ?? undefined}
              organizationId={organizationId}
              canLoadMore={canLoadMore}
              isLoadingMore={isLoadingMore}
              loadMore={loadMore}
              isLoading={isLoading}
              isSendPending={isSendPending}
              generationStartMs={generationStartMs}
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
        variant="assistant"
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

export function AutomationAssistant(props: AutomationAssistantProps) {
  // The assistant reuses the chat composer (`ChatInput`) and its sub-controls,
  // the pending-message channel (`usePendingMessages`), and the message stack
  // (`ChatMessages`), all of which read `useChatLayout`. Provide the context
  // here so the panel works standalone on the automations routes (it isn't
  // under the chat page's provider). Keyed by org, same as chat — the panels
  // live on separate routes, so they never mount simultaneously.
  return (
    <ChatLayoutProvider organizationId={props.organizationId}>
      <FileUpload.Root>
        <AutomationAssistantContent {...props} />
      </FileUpload.Root>
    </ChatLayoutProvider>
  );
}
