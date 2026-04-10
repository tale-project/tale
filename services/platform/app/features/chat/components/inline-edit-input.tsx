'use client';

import { Loader2 } from 'lucide-react';
import { useRef, useState, useEffect, useCallback } from 'react';

import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface InlineEditInputProps {
  messageContent: string;
  onSubmit: (newContent: string) => Promise<void>;
  onCancel: () => void;
}

export function InlineEditInput({
  messageContent,
  onSubmit,
  onCancel,
}: InlineEditInputProps) {
  const { t } = useT('common');
  const { t: tChat } = useT('chat');
  const [value, setValue] = useState(messageContent);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.focus();
      textareaRef.current.style.height = 'auto';
      textareaRef.current.style.height = `${textareaRef.current.scrollHeight}px`;
      const len = textareaRef.current.value.length;
      textareaRef.current.setSelectionRange(len, len);
    }
  }, []);

  const handleSubmit = useCallback(async () => {
    const trimmed = value.trim();
    if (!trimmed || trimmed === messageContent || isSubmitting) return;

    setIsSubmitting(true);
    try {
      await onSubmit(trimmed);
    } finally {
      setIsSubmitting(false);
    }
  }, [value, messageContent, isSubmitting, onSubmit]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        void handleSubmit();
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      }
    },
    [handleSubmit, onCancel],
  );

  const canSubmit = !!value.trim() && value.trim() !== messageContent;

  return (
    <div className="bg-muted/50 border-border flex flex-col gap-3 rounded-2xl border p-4">
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
        aria-label={tChat('editMessage')}
        className="text-foreground min-h-[2.5rem] w-full resize-none bg-transparent text-sm leading-6 focus:outline-none disabled:opacity-50"
        rows={1}
      />
      <div className="flex items-center justify-end gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          disabled={isSubmitting}
          className="rounded-full"
        >
          {t('actions.cancel')}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={() => void handleSubmit()}
          disabled={!canSubmit || isSubmitting}
          className="rounded-full"
        >
          {isSubmitting && <Loader2 className="mr-1.5 size-3.5 animate-spin" />}
          {tChat('editSend')}
        </Button>
      </div>
    </div>
  );
}
