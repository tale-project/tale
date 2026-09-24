'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { FormDialog } from '@tale/ui/dialog/form-dialog';
import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { type RefObject, useMemo } from 'react';
import * as z from 'zod';

import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '@/backend/core/knowledge_entries/constants';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useUpdateKnowledgeEntry } from '../hooks/mutations';
import type { KnowledgeEntryItem } from '../hooks/queries';

type FormData = {
  topic: string;
  content: string;
};

interface KnowledgeEntryEditDialogProps {
  isOpen: boolean;
  onClose: () => void;
  entry: KnowledgeEntryItem;
  /** Runs after a successful save, before the dialog closes. */
  onSaved?: () => void;
  /** Stable focus target when the opener (a row menu item) unmounts. */
  restoreFocusRef?: RefObject<HTMLElement | null>;
}

export function KnowledgeEntryEditDialog({
  isOpen,
  onClose,
  entry,
  onSaved,
  restoreFocusRef,
}: KnowledgeEntryEditDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { mutate: updateEntry, isPending } = useUpdateKnowledgeEntry();

  const formSchema = useMemo(
    () =>
      z.object({
        topic: z
          .string()
          .trim()
          .min(1, t('validation.topicRequired'))
          .max(TOPIC_MAX_LENGTH, t('validation.topicTooLong')),
        content: z
          .string()
          .trim()
          .min(1, t('validation.contentRequired'))
          .max(CONTENT_MAX_LENGTH, t('validation.contentTooLong')),
      }),
    [t],
  );

  const {
    register,
    handleSubmit,
    formState: { errors, isDirty },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { topic: entry.topic, content: entry.content },
  });

  const onSubmit = (data: FormData) => {
    updateEntry(
      {
        entryId: entry._id,
        topic: data.topic,
        content: data.content,
      },
      {
        onSuccess: () => {
          toast({ title: t('toast.updateSuccess'), variant: 'success' });
          onSaved?.();
          onClose();
        },
        onError: (error) => {
          console.error('Failed to update knowledge entry:', error);
          const isDuplicate =
            backendErrorCode(error) === 'KNOWLEDGE_ENTRY_DUPLICATE';
          toast({
            title: isDuplicate
              ? t('toast.addErrorDuplicate')
              : t('toast.updateError'),
            variant: 'destructive',
          });
        },
      },
    );
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={(open) => !open && handleClose()}
      title={t('editEntry')}
      submittingText={t('saving')}
      isSubmitting={isPending}
      isDirty={isDirty}
      onSubmit={handleSubmit(onSubmit)}
      size="entity"
      restoreFocusRef={restoreFocusRef}
    >
      <Input
        id="topic"
        type="text"
        label={t('topic')}
        placeholder={t('topicPlaceholder')}
        required
        {...register('topic')}
        disabled={isPending}
        errorMessage={errors.topic?.message}
      />

      <Textarea
        id="content"
        label={t('content')}
        placeholder={t('contentPlaceholder')}
        required
        rows={4}
        {...register('content')}
        disabled={isPending}
        errorMessage={errors.content?.message}
      />
    </FormDialog>
  );
}
