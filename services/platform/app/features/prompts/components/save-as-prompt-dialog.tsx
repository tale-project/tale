'use client';

import { useState, useCallback } from 'react';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Input } from '@/app/components/ui/forms/input';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useOrganizationId } from '@/app/hooks/use-organization-id';
import { useT } from '@/lib/i18n/client';

import { useCreatePrompt } from '../hooks/mutations';

export interface SaveAsPromptDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialContent: string;
}

function SaveAsPromptDialogContent({
  open,
  onOpenChange,
  initialContent,
}: SaveAsPromptDialogProps) {
  const { t } = useT('prompts');
  const organizationId = useOrganizationId();
  const createPrompt = useCreatePrompt();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [content, setContent] = useState(initialContent);

  const isValid = title.trim().length > 0 && content.trim().length > 0;

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault();
      if (!isValid || !organizationId) return;

      await createPrompt.mutateAsync({
        organizationId,
        title: title.trim(),
        content: content.trim(),
        description: description.trim() || undefined,
        scope: 'personal',
        isPublished: true,
      });

      onOpenChange(false);
    },
    [
      isValid,
      organizationId,
      title,
      content,
      description,
      createPrompt,
      onOpenChange,
    ],
  );

  return (
    <FormDialog
      open={open}
      onOpenChange={onOpenChange}
      title={t('saveAs.title')}
      description={t('saveAs.description')}
      onSubmit={handleSubmit}
      isSubmitting={createPrompt.isPending}
      isDirty={isValid}
      submitText={t('form.save')}
      large
    >
      <Input
        label={t('form.titleLabel')}
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder={t('form.titlePlaceholder')}
        required
        aria-required
      />
      <Input
        label={t('form.descriptionLabel')}
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder={t('form.descriptionPlaceholder')}
      />
      <Textarea
        value={content}
        onChange={(e) => setContent(e.target.value)}
        className="min-h-[120px] font-mono text-sm"
        required
        aria-required
        aria-label={t('form.contentLabel')}
      />
    </FormDialog>
  );
}

export function SaveAsPromptDialog(props: SaveAsPromptDialogProps) {
  if (!props.open) return null;
  return <SaveAsPromptDialogContent {...props} />;
}
