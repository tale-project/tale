'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { Input } from '@tale/ui/input';
import { Textarea } from '@tale/ui/textarea';
import { useForm } from '@tale/ui/use-form';
import { toast } from '@tale/ui/use-toast';
import { useMemo } from 'react';
import * as z from 'zod';

import {
  CONTENT_MAX_LENGTH,
  TOPIC_MAX_LENGTH,
} from '@/backend/core/knowledge_entries/constants';
import { useT } from '@/lib/i18n/client';
import { backendErrorCode } from '@/lib/utils/backend-error';

import { useUpdateKnowledgeEntry } from '../hooks/mutations';
import type { KnowledgeEntryItem } from '../hooks/queries';

export const KNOWLEDGE_ENTRY_EDIT_FORM_ID = 'knowledge-entry-edit';

type FormData = {
  topic: string;
  content: string;
};

export function useKnowledgeEntryEditForm(
  entry: KnowledgeEntryItem,
  onSaved: () => void,
) {
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
    formState: { errors },
    reset,
  } = useForm<FormData>({
    resolver: zodResolver(formSchema),
    defaultValues: { topic: entry.topic, content: entry.content },
  });

  const submit = handleSubmit((data) => {
    updateEntry(
      {
        entryId: entry._id,
        topic: data.topic,
        content: data.content,
      },
      {
        onSuccess: () => {
          toast({ title: t('toast.updateSuccess'), variant: 'success' });
          onSaved();
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
  });

  return { register, errors, isPending, reset, submit };
}

export function KnowledgeEntryEditFields({
  register,
  errors,
  disabled,
  autoFocus = false,
}: {
  register: ReturnType<typeof useKnowledgeEntryEditForm>['register'];
  errors: ReturnType<typeof useKnowledgeEntryEditForm>['errors'];
  disabled: boolean;
  autoFocus?: boolean;
}) {
  const { t } = useT('knowledgeEntries');

  return (
    <>
      <Input
        id="topic"
        type="text"
        label={t('topic')}
        placeholder={t('topicPlaceholder')}
        required
        {...register('topic')}
        autoFocus={autoFocus}
        disabled={disabled}
        errorMessage={errors.topic?.message}
      />
      <Textarea
        id="content"
        label={t('content')}
        placeholder={t('contentPlaceholder')}
        required
        rows={8}
        {...register('content')}
        disabled={disabled}
        errorMessage={errors.content?.message}
      />
    </>
  );
}
