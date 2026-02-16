'use client';

import { Trash2, X } from 'lucide-react';

import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { ImagePreviewDialog } from '@/app/features/chat/components/message-bubble';
import { useT } from '@/lib/i18n/client';

import { useTestChat } from '../hooks/use-test-chat';
import { TestChatInput } from './test-chat-panel/test-chat-input';
import { TestMessageList } from './test-chat-panel/test-message-list';

interface TestChatPanelProps {
  organizationId: string;
  agentId: string;
  onClose: () => void;
  onReset?: () => void;
}

function TestChatPanelContent({
  organizationId,
  agentId,
  onClose,
  onReset,
}: TestChatPanelProps) {
  const { t } = useT('settings');

  const {
    displayItems,
    isBusy,
    isUploading,
    threadId,
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
    handleClearChat,
  } = useTestChat({
    organizationId,
    agentId,
    onReset,
    errorMessageText: t('customAgents.testChat.sendFailed'),
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
        <h2 className="truncate text-sm font-semibold">
          {t('customAgents.testChat.title')}
        </h2>
        <div className="flex items-center gap-1">
          {displayItems.length > 0 && threadId && (
            <IconButton
              icon={Trash2}
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

      <div
        ref={containerRef}
        className="relative flex flex-1 flex-col overflow-y-auto"
      >
        <div className="flex flex-1 flex-col space-y-2.5 p-3">
          <TestMessageList
            displayItems={displayItems}
            isBusy={isBusy}
            organizationId={organizationId}
            onImagePreview={(src, alt) =>
              setPreviewImage({ isOpen: true, src, alt })
            }
          />
          <div ref={messagesEndRef} />
        </div>
      </div>

      <TestChatInput
        inputValue={inputValue}
        onInputChange={setInputValue}
        onKeyDown={handleKeyDown}
        onPaste={handlePaste}
        onSend={handleSendMessage}
        isBusy={isBusy}
        isUploading={isUploading}
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

export function TestChatPanel(props: TestChatPanelProps) {
  return (
    <FileUpload.Root>
      <TestChatPanelContent {...props} />
    </FileUpload.Root>
  );
}
