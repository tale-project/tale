'use client';

import { Button } from '@tale/ui/button';
import { HStack } from '@tale/ui/layout';
import { Text } from '@tale/ui/text';
import { Tooltip } from '@tale/ui/tooltip';
import {
  LoaderCircleIcon,
  PaperclipIcon,
  Send,
  WandSparklesIcon,
} from 'lucide-react';
import { memo, useRef, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AttachedFile } from './types';
import { getFileType } from './types';

interface EditorActionBarProps {
  disabled: boolean;
  sendDisabledReason?: ReactNode;
  isLoading: boolean;
  isImproveMode: boolean;
  isImproving: boolean;
  isSending: boolean;
  hasContent: boolean;
  attachedFiles: AttachedFile[];
  onFileAttach: (file: AttachedFile) => void;
  onImproveOpen: () => void;
  onImproveSubmit: () => void;
  onSend: () => void;
  replyDestination?: string;
}

export const EditorActionBar = memo(function EditorActionBar({
  disabled,
  sendDisabledReason,
  isLoading,
  isImproveMode,
  isImproving,
  isSending,
  hasContent,
  attachedFiles,
  onFileAttach,
  onImproveOpen,
  onImproveSubmit,
  onSend,
  replyDestination,
}: EditorActionBarProps) {
  const { t: tConversations } = useT('conversations');
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileInputClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onFileAttach({
        id: Date.now().toString() + Math.random().toString(36).slice(2, 11),
        file,
        type: getFileType(file),
      });
    }
    event.target.value = '';
  };

  return (
    <HStack justify="between" className="pt-1">
      {!isImproveMode && (
        <HStack gap={2}>
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
            title={tConversations('editor.attachFile')}
          >
            <PaperclipIcon className="size-4" />
          </Button>
          <Tooltip content={tConversations('editor.improveWithAi')}>
            <Button
              onClick={onImproveOpen}
              disabled={
                disabled || isLoading || !hasContent || isImproving || isSending
              }
              variant="ghost"
              size="icon"
              aria-label={tConversations('editor.improveWithAi')}
            >
              {isImproving ? (
                <LoaderCircleIcon className="text-muted-foreground size-4 animate-spin" />
              ) : (
                <WandSparklesIcon className="size-4" />
              )}
            </Button>
          </Tooltip>
        </HStack>
      )}
      {isImproveMode && <div />}

      {!isImproveMode && replyDestination !== undefined && (
        <Text variant="caption" className="truncate">
          {replyDestination}
        </Text>
      )}
      {!isImproveMode && (
        <Button
          onClick={onSend}
          size="icon"
          title={tConversations('editor.send')}
          disabled={
            disabled ||
            isLoading ||
            (!hasContent && attachedFiles.length === 0) ||
            isImproving ||
            isSending
          }
          disabledReason={disabled ? sendDisabledReason : undefined}
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
        <Tooltip
          content={
            isImproving
              ? tConversations('editor.improving')
              : tConversations('editor.generateImprovement')
          }
        >
          <Button
            onClick={onImproveSubmit}
            size="icon"
            aria-label={
              isImproving
                ? tConversations('editor.improving')
                : tConversations('editor.generateImprovement')
            }
            disabled={isImproving}
            className="rounded-full"
          >
            {isImproving ? (
              <LoaderCircleIcon className="size-4 animate-spin" />
            ) : (
              <WandSparklesIcon className="size-4" />
            )}
          </Button>
        </Tooltip>
      )}
    </HStack>
  );
});
