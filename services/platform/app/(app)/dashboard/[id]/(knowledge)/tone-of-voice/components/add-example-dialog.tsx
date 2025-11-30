'use client';

import { useState } from 'react';
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
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="max-w-lg p-0 gap-0 rounded-2xl">
        {/* Header */}
        <DialogHeader className="py-6 px-4 border-b border-border">
          <DialogTitle className="font-semibold text-foreground tracking-[-0.3px]">
            Add example
          </DialogTitle>
        </DialogHeader>

        {/* Form Content */}
        <div className="p-4">
          <form
            id="add-example-form"
            onSubmit={handleSubmit(onSubmit)}
            className="space-y-5"
          >
            {/* Message Field */}
            <div className="space-y-2">
              <Label
                htmlFor="content"
                className="text-sm font-medium text-foreground tracking-[-0.21px]"
              >
                Message
              </Label>
              <Textarea
                {...register('content', { required: true })}
                placeholder="e.g. Hello, I hope this finds you well."
                className="min-h-[10rem] px-4 py-3 bg-background border border-border rounded-lg shadow-sm text-sm resize-none"
              />
            </div>
          </form>
        </div>

        {/* Button Footer */}
        <div className="border-t border-border p-4">
          <div className="flex gap-3">
            <Button
              type="button"
              variant="outline"
              onClick={handleClose}
              className="flex-1"
            >
              Cancel
            </Button>
            <Button
              type="submit"
              form="add-example-form"
              disabled={!isValid || isSubmitting}
              className="flex-1"
            >
              {isSubmitting ? 'Adding...' : 'Add'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
