'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { useMemo } from 'react';
import * as z from 'zod';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useForm } from '@/app/components/ui/forms/use-form';
import { toast } from '@/app/hooks/use-toast';
import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '@/convex/knowledge_entries/constants';
import { useT } from '@/lib/i18n/client';
import { convexErrorCode } from '@/lib/utils/convex-error';

import { useCreateKnowledgeEntry } from '../hooks/mutations';

type FormData = {
  topic: string;
  content: string;
};

interface AddKnowledgeEntryDialogProps {
  isOpen: boolean;
  onClose: () => void;
  organizationId: string;
}

export function AddKnowledgeEntryDialog({
  isOpen,
  onClose,
  organizationId,
}: AddKnowledgeEntryDialogProps) {
  const { t } = useT('knowledgeEntries');
  const { mutate: createEntry, isPending } = useCreateKnowledgeEntry();

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
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { topic: '', content: '' },
  });

  const onSubmit = (data: FormData) => {
    createEntry(
      {
        organizationId,
        topic: data.topic,
        content: data.content,
      },
      {
        onSuccess: () => {
          toast({ title: t('toast.addSuccess'), variant: 'success' });
          reset();
          onClose();
        },
        onError: (error) => {
          console.error('Failed to add knowledge entry:', error);
          const isDuplicate =
            convexErrorCode(error) === 'KNOWLEDGE_ENTRY_DUPLICATE';
          toast({
            title: isDuplicate
              ? t('toast.addErrorDuplicate')
              : t('toast.addError'),
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
      title={t('addEntry')}
      submittingText={t('adding')}
      isSubmitting={isPending}
      onSubmit={handleSubmit(onSubmit)}
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
        rows={8}
        {...register('content')}
        disabled={isPending}
        errorMessage={errors.content?.message}
      />
    </FormDialog>
  );
}
