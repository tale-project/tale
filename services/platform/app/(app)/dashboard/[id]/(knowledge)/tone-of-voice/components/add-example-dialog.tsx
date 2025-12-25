'use client';

import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { FormModal } from '@/components/ui/modals';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';

interface AddExampleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  onAdd: (example: { content: string }) => Promise<void>;
}

interface ExampleFormData {
  content: string;
}

export default function AddExampleDialog({
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
    <FormModal
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
      <div className="space-y-2">
        <Label
          htmlFor="content"
          className="text-sm font-medium text-foreground tracking-[-0.21px]"
        >
          {tTables('headers.message')}
        </Label>
        <Textarea
          {...register('content', { required: true })}
          placeholder={tTone('exampleMessages.placeholder')}
          className="min-h-[10rem] px-4 py-3 bg-background border border-border rounded-lg shadow-sm text-sm resize-none"
        />
      </div>
    </FormModal>
  );
}
