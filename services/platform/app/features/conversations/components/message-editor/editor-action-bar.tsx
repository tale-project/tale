'use client';

import {
  LoaderCircleIcon,
  PaperclipIcon,
  Send,
  WandSparklesIcon,
} from 'lucide-react';
import { memo, useRef } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

import type { AttachedFile } from './types';

import { getFileType } from './types';

interface EditorActionBarProps {
  disabled: boolean;
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
}

export const EditorActionBar = memo(function EditorActionBar({
  disabled,
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
          <Tooltip content={tConversations('editor.improveWithAi')}>
            <Button
              onClick={onImproveOpen}
              disabled={
                disabled || isLoading || !hasContent || isImproving || isSending
              }
              variant="ghost"
              size="icon"
            >
              {isImproving ? (
                <LoaderCircleIcon className="text-muted-foreground size-4 animate-spin" />
              ) : (
                <WandSparklesIcon className="size-4" />
              )}
            </Button>
          </Tooltip>
        </div>
      )}
      {isImproveMode && <div />}

      {!isImproveMode && (
        <Button
          onClick={onSend}
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
    </div>
  );
});
