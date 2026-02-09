'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';

import { FormDialog } from '@/app/components/ui/dialog/form-dialog';
import { Textarea } from '@/app/components/ui/forms/textarea';
import { useT } from '@/lib/i18n/client';

interface AddExampleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (example: { content: string }) => Promise<void>;
}

interface ExampleFormData {
  content: string;
}

export function AddExampleDialog({
  isOpen,
  onClose,
  onAdd,
}: AddExampleDialogProps) {
  const { t: tTone } = useT('toneOfVoice');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ExampleFormData>({
    defaultValues: {
      content: '',
    },
  });

  const { register, handleSubmit, reset, formState } = form;
  const { isValid } = formState;

  const onSubmit = async (data: ExampleFormData) => {
    if (!data.content.trim()) return;

    setIsSubmitting(true);
    try {
      await onAdd({
        content: data.content.trim(),
      });
      reset();
      onClose();
    } catch (error) {
      console.error('Error adding example:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  return (
    <FormDialog
      open={isOpen}
      onOpenChange={handleClose}
      title={tTone('exampleMessages.addButton')}
      submitText={tCommon('actions.add')}
      submittingText={tTone('exampleMessages.adding')}
      isSubmitting={isSubmitting}
      submitDisabled={!isValid}
      onSubmit={handleSubmit(onSubmit)}
      className="max-w-lg"
    >
      <Textarea
        {...register('content', { required: true })}
        label={tTables('headers.message')}
        placeholder={tTone('exampleMessages.placeholder')}
        className="bg-background border-border min-h-[10rem] resize-none rounded-lg border px-4 py-3 text-sm shadow-sm"
      />
    </FormDialog>
  );
}
