'use client';

import { useState, useEffect } from 'react';
import { useForm } from 'react-hook-form';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useT } from '@/lib/i18n';

interface ViewEditExampleDialogProps {
  isOpen: boolean;
  onClose: () => void;
  mode: 'view' | 'edit';
  example: {
    id: string;
    content: string;
    updatedAt: Date;
  } | null;
  onUpdate?: (exampleId: string, content: string) => Promise<void>;
}

interface ExampleFormData {
  content: string;
}

export default function ViewEditExampleDialog({
  isOpen,
  onClose,
  mode: initialMode,
  example,
  onUpdate,
}: ViewEditExampleDialogProps) {
  const { t: tTone } = useT('toneOfVoice');
  const { t: tCommon } = useT('common');
  const { t: tTables } = useT('tables');
  const [mode, setMode] = useState<'view' | 'edit'>(initialMode);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const form = useForm<ExampleFormData>({
    defaultValues: {
      content: example?.content || '',
    },
  });

  const { register, handleSubmit, reset, formState } = form;
  const { isValid, isDirty } = formState;

  // Reset form when example changes
  useEffect(() => {
    if (example) {
      reset({ content: example.content });
    }
  }, [example, reset]);

  // Reset mode when dialog opens/closes or initialMode changes
  useEffect(() => {
    setMode(initialMode);
  }, [initialMode, isOpen]);

  const onSubmit = async (data: ExampleFormData) => {
    if (!data.content.trim() || !example || !onUpdate) return;

    setIsSubmitting(true);
    try {
      await onUpdate(example.id, data.content.trim());
      reset({ content: data.content.trim() });
      onClose();
    } catch (error) {
      console.error('Error updating example:', error);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleClose = () => {
    reset({ content: example?.content || '' });
    setMode(initialMode);
    onClose();
  };

  const handleEditClick = () => {
    setMode('edit');
  };

  const handleCancelEdit = () => {
    reset({ content: example?.content || '' });
    setMode('view');
  };

  if (!example) return null;

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg p-0 gap-0 rounded-2xl">
        {/* Header */}
        <DialogHeader className="py-6 px-4 border-b border-border">
          <DialogTitle className="font-semibold text-foreground tracking-[-0.3px]">
            {mode === 'view' ? tTone('exampleMessages.viewExample') : tTone('exampleMessages.editExample')}
          </DialogTitle>
        </DialogHeader>

        {/* Form Content */}
        <div className="p-4">
          <form
            id="view-edit-example-form"
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-5"
          >
            {/* Message Field */}
            <div className="space-y-2">
              <Label
                htmlFor="content"
                className="text-sm font-medium text-foreground tracking-[-0.21px]"
              >
                {tTables('headers.message')}
              </Label>
              {mode === 'view' ? (
                <div className="min-h-[10rem] px-4 py-3 bg-muted border border-border rounded-lg text-sm text-foreground whitespace-pre-wrap">
                  {example.content}
                </div>
              ) : (
                <Textarea
                  {...register('content', { required: true })}
                  placeholder={tTone('exampleMessages.placeholder')}
                  className="min-h-[10rem] px-4 py-3 bg-background border border-border rounded-lg shadow-sm text-sm resize-none"
                />
              )}
            </div>
          </form>
        </div>

        {/* Button Footer */}
        <div className="border-t border-border p-4">
          {mode === 'view' ? (
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleClose}
                className="flex-1"
              >
                {tCommon('actions.close')}
              </Button>
              <Button
                type="button"
                onClick={handleEditClick}
                className="flex-1"
              >
                {tCommon('actions.edit')}
              </Button>
            </div>
          ) : (
            <div className="flex gap-3">
              <Button
                type="button"
                variant="outline"
                onClick={handleCancelEdit}
                className="flex-1"
              >
                {tCommon('actions.cancel')}
              </Button>
              <Button
                type="submit"
                form="view-edit-example-form"
                disabled={!isValid || !isDirty || isSubmitting}
                className="flex-1"
              >
                {isSubmitting ? tCommon('actions.saving') : tCommon('actions.saveChanges')}
              </Button>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
