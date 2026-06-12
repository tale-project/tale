'use client';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { ChatInput } from '@/app/features/chat/components/chat-input';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import { ChatLayoutProvider } from '@/app/features/chat/context/chat-layout-context';
import { useT } from '@/lib/i18n/client';

import { useAssistantChat } from '../hooks/use-assistant-chat';
import { MessageList } from './automation-assistant/message-list';

interface AutomationAssistantProps {
  /** 'workflow' (default) edits automations; 'organigram' edits the chart. */
  mode?: 'workflow' | 'organigram';
  workflowSlug?: string;
  workflowName?: string;
  organizationId: string;
}

function AutomationAssistantContent({
  mode = 'workflow',
  workflowSlug,
  workflowName,
  organizationId,
}: AutomationAssistantProps) {
  const { t } = useT('automations');

  const {
    workflow,
    displayMessages,
    isLoading,
    isWaitingForResponse,
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
    previewImage,
    setPreviewImage,
    containerRef,
    messagesEndRef,
    handleSendMessage,
    workflowUpdateApprovals,
    workflowCreationApprovals,
    workflowRunApprovals,
    humanInputRequests,
    documentWriteApprovals,
    integrationApprovals,
  } = useAssistantChat({
    mode,
    workflowSlug,
    workflowName,
    organizationId,
    errorMessageText: t('assistant.errorMessage'),
    analyzeAttachmentsText: t('assistant.analyzeAttachments'),
  });

  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={containerRef}
        className="flex min-h-0 flex-1 flex-col space-y-2.5 overflow-y-auto p-2"
      >
        <MessageList
          displayMessages={displayMessages}
          isLoading={isLoading}
          isWaitingForResponse={isWaitingForResponse}
          workflow={workflow}
          organizationId={organizationId}
          workflowUpdateApprovals={workflowUpdateApprovals}
          workflowCreationApprovals={workflowCreationApprovals}
          workflowRunApprovals={workflowRunApprovals}
          humanInputRequests={humanInputRequests}
          documentWriteApprovals={documentWriteApprovals}
          integrationApprovals={integrationApprovals}
          onImagePreview={(src, alt) =>
            setPreviewImage({ isOpen: true, src, alt })
          }
        />
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        className="p-2"
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

export function AutomationAssistant(props: AutomationAssistantProps) {
  // The assistant reuses the chat composer (`ChatInput`) and its sub-controls
  // (agent/model selectors, capability pills, quoted-reference chip), all of
  // which read `useChatLayout`. Provide the context here so the panel works
  // standalone on the automations/organigram routes (it isn't under the chat
  // page's provider). Keyed by org, same as chat — the panels live on
  // separate routes, so they never mount simultaneously.
  return (
    <ChatLayoutProvider organizationId={props.organizationId}>
      <FileUpload.Root>
        <AutomationAssistantContent {...props} />
      </FileUpload.Root>
    </ChatLayoutProvider>
  );
}
