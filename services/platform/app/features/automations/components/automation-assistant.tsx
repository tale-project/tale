'use client';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

import { useAssistantChat } from '../hooks/use-assistant-chat';
import { ChatInput } from './automation-assistant/chat-input';
import { MessageList } from './automation-assistant/message-list';

interface AutomationAssistantProps {
  automationId?: Id<'wfDefinitions'>;
  organizationId: string;
}

function AutomationAssistantContent({
  automationId,
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
    previewImage,
    setPreviewImage,
    containerRef,
    messagesEndRef,
    fileInputRef,
    handleFileInputChange,
    handlePaste,
    handleSendMessage,
    handleKeyDown,
    workflowUpdateApprovals,
    workflowCreationApprovals,
  } = useAssistantChat({
    automationId,
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
          onImagePreview={(src, alt) =>
            setPreviewImage({ isOpen: true, src, alt })
          }
        />
        <div ref={messagesEndRef} />
      </div>

      <ChatInput
        inputValue={inputValue}
        onInputChange={setInputValue}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onSend={handleSendMessage}
        isLoading={isLoading}
        attachments={attachments}
        uploadingFiles={uploadingFiles}
        uploadFiles={uploadFiles}
        removeAttachment={removeAttachment}
        fileInputRef={fileInputRef}
        onFileInputChange={handleFileInputChange}
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
  return (
    <FileUpload.Root>
      <AutomationAssistantContent {...props} />
    </FileUpload.Root>
  );
}
