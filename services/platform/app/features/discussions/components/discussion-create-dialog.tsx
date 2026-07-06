'use client';

import { Button } from '@tale/ui/button';
import { Row, Stack } from '@tale/ui/layout';
import { useMemo, useState } from 'react';

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
import { toastUnresolvedMentions } from '@/lib/shared/mention-unresolved';
import { cn } from '@/lib/utils/cn';

import { ChatInput } from '../../chat/components/chat-input';
import { useConvexFileUpload } from '../../chat/hooks/use-convex-file-upload';
import type { FileAttachment } from '../../chat/types';
import { useCreateDiscussion } from '../hooks/mutations';
import { createActorMentionSource } from './actor-mention-source';

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
  const { t: tCommon } = useT('common');
  const [title, setTitle] = useState('');
  const [category, setCategory] = useState<DiscussionCategory>(
    DEFAULT_DISCUSSION_CATEGORY,
  );
  const [body, setBody] = useState('');
  const [titleError, setTitleError] = useState<string | undefined>();
  const [isCreating, setIsCreating] = useState(false);

  const {
    attachments,
    uploadingFiles,
    uploadFiles,
    removeAttachment,
    clearAttachments,
  } = useConvexFileUpload({ organizationId });

  const { mutateAsync: createDiscussion } = useCreateDiscussion();
  const actorMentionSource = useMemo(
    () => createActorMentionSource({ organizationId, projectId }),
    [organizationId, projectId],
  );

  const reset = () => {
    setTitle('');
    setCategory(DEFAULT_DISCUSSION_CATEGORY);
    setBody('');
    setTitleError(undefined);
    clearAttachments();
  };

  const handleCreate = async (message: string, _att?: FileAttachment[]) => {
    if (isCreating) return;
    if (!title.trim()) {
      setTitleError(t('create.titleRequired'));
      return;
    }
    if (!message.trim()) return;
    setTitleError(undefined);
    setIsCreating(true);
    try {
      const result = await createDiscussion({
        organizationId,
        projectId,
        title: title.trim(),
        message,
        category,
      });
      toastUnresolvedMentions(result.unresolvedMentionTokens, toast, tCommon);
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
          onChange={(e) => {
            setTitle(e.target.value);
            if (titleError) setTitleError(undefined);
          }}
          placeholder={t('create.titlePlaceholder')}
          errorMessage={titleError}
          required
          autoFocus
        />
        <div className="flex flex-col gap-1.5">
          <span className="text-sm font-medium">{t('create.category')}</span>
          <Row gap={2} align="stretch" wrap>
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
          </Row>
        </div>
        <FileUpload.Root>
          <ChatInput
            variant="assistant"
            placeholder={t('create.bodyPlaceholder')}
            value={body}
            onChange={setBody}
            onSendMessage={handleCreate}
            isLoading={isCreating}
            organizationId={organizationId}
            projectId={String(projectId)}
            actorMentionSource={actorMentionSource}
            attachments={attachments}
            uploadingFiles={uploadingFiles}
            uploadFiles={uploadFiles}
            removeAttachment={removeAttachment}
            clearAttachments={clearAttachments}
          />
        </FileUpload.Root>
        <p className="text-muted-foreground text-xs">{t('create.hint')}</p>
        <Row gap={0} align="stretch" justify="end">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {t('create.cancel')}
          </Button>
        </Row>
      </Stack>
    </Dialog>
  );
}
