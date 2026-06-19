'use client';

import { Button } from '@tale/ui/button';
import { Stack } from '@tale/ui/layout';
import { useState } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { FileUpload } from '@/app/components/ui/forms/file-upload';
import { Input } from '@/app/components/ui/forms/input';
import { toast } from '@/app/hooks/use-toast';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import {
  DEFAULT_DISCUSSION_CATEGORIES,
  DEFAULT_DISCUSSION_CATEGORY,
  type DiscussionCategory,
} from '@/lib/shared/constants/discussions';
import { cn } from '@/lib/utils/cn';

import { ChatInput } from '../../chat/components/chat-input';
import { useConvexFileUpload } from '../../chat/hooks/use-convex-file-upload';
import type { FileAttachment } from '../../chat/types';
import { useCreateDiscussion } from '../hooks/mutations';

interface DiscussionCreateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  projectId: Id<'projects'>;
  onCreated: (threadId: string) => void;
}

export function DiscussionCreateDialog({
  open,
  onOpenChange,
  organizationId,
  projectId,
  onCreated,
}: DiscussionCreateDialogProps) {
  const { t } = useT('discussions');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DiscussionCategory>(
    DEFAULT_DISCUSSION_CATEGORY,
  );
  const [body, setBody] = useState('');
  const [isCreating, setIsCreating] = useState(false);

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });

  const { mutateAsync: createDiscussion } = useCreateDiscussion();

  const reset = () => {
    setTitle('');
    setCategory(DEFAULT_DISCUSSION_CATEGORY);
    setBody('');
    clearAttachments();
  };

  const handleCreate = async (message: string, _att?: FileAttachment[]) => {
    if (!title.trim() || !message.trim() || isCreating) return;
    setIsCreating(true);
    try {
      const result = await createDiscussion({
        organizationId,
        projectId,
        title: title.trim(),
        message,
        category,
      });
      reset();
      onCreated(result.threadId);
    } catch (error) {
      console.error('Failed to create discussion', error);
      toast({ title: t('create.failed'), variant: 'destructive' });
    } finally {
      setIsCreating(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) reset();
        onOpenChange(next);
      }}
      title={t('create.title')}
      size="lg"
    >
      <Stack gap={4}>
        <Input
          label={t('create.titleLabel')}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={t('create.titlePlaceholder')}
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('create.category')}</span>
          <div className="flex flex-wrap gap-2">
            {DEFAULT_DISCUSSION_CATEGORIES.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border px-3 py-1 text-xs transition-colors',
                  category === c
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:bg-muted/50',
                )}
              >
                {t(`categories.${c}`)}
              </button>
            ))}
          </div>
        </div>
        <FileUpload.Root>
          <ChatInput
            variant="assistant"
            placeholder={t('create.bodyPlaceholder')}
            value={body}
            onChange={setBody}
            onSendMessage={handleCreate}
            isLoading={isCreating}
            sendBlocked={!title.trim()}
            sendBlockedReason={t('create.titleRequired')}
            organizationId={organizationId}
            projectId={String(projectId)}
            attachments={attachments}
            uploadingFiles={uploadingFiles}
            uploadFiles={uploadFiles}
            removeAttachment={removeAttachment}
            clearAttachments={clearAttachments}
          />
        </FileUpload.Root>
        <p className="text-muted-foreground text-xs">{t('create.hint')}</p>
        <div className="flex justify-end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('create.cancel')}
          </Button>
        </div>
      </Stack>
    </Dialog>
  );
}
