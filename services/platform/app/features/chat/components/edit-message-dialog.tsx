'use client';

import { Loader2 } from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';

import { Dialog } from '@/app/components/ui/dialog/dialog';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface EditMessageDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageContent: string;
  /** Called on submit. Return a promise — dialog stays open with loading state until it resolves. */
  onSubmit: (newContent: string) => Promise<void>;
}

function EditMessageDialogContent({
  open,
  onOpenChange,
  messageContent,
  onSubmit,
}: EditMessageDialogProps) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const [value, setValue] = useState(messageContent);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    setValue(messageContent);
  }, [messageContent]);

  // Auto-focus and auto-resize on open
  useEffect(() => {
    if (open && textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, [open]);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === messageContent || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
      onOpenChange(false);
    } finally {
      setIsSubmitting(false);
    }
  }, [value, messageContent, isSubmitting, onSubmit, onOpenChange]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
    },
    [handleSubmit],
  );

  const canSubmit = !!value.trim() && value.trim() !== messageContent;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!isSubmitting) onOpenChange(o);
      }}
      title={tChat('editMessage')}
      hideClose
      size="lg"
      footer={
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={() => onOpenChange(false)}
            disabled={isSubmitting}
          >
            {t('actions.cancel')}
          </Button>
          <Button
            variant="primary"
            onClick={() => void handleSubmit()}
            disabled={!canSubmit || isSubmitting}
          >
            {isSubmitting && (
              <Loader2 className="mr-1.5 size-3.5 animate-spin" />
            )}
            {tChat('editSend')}
          </Button>
        </div>
      }
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          e.target.style.height = 'auto';
          e.target.style.height = `${e.target.scrollHeight}px`;
        }}
        onKeyDown={handleKeyDown}
        disabled={isSubmitting}
        className="border-border bg-background text-foreground max-h-[50vh] min-h-[4rem] w-full resize-none rounded-lg border p-3 text-sm leading-6 focus:outline-none disabled:opacity-50"
        rows={3}
      />
    </Dialog>
  );
}

/**
 * Dialog for editing a previously sent message.
 * Wraps with conditional render to prevent hook conflicts during close animation.
 */
export function EditMessageDialog(props: EditMessageDialogProps) {
  if (!props.open) return null;
  return <EditMessageDialogContent {...props} />;
}
