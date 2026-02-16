'use client';

import { ChevronLeft } from 'lucide-react';
import { memo, useEffect, useRef } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface ImproveModeProps {
  instruction: string;
  isImproving: boolean;
  onInstructionChange: (value: string) => void;
  onClose: () => void;
  onSubmit: () => void;
}

export const ImproveMode = memo(function ImproveMode({
  instruction,
  isImproving,
  onInstructionChange,
  onClose,
  onSubmit,
}: ImproveModeProps) {
  const { t: tConversations } = useT('conversations');
  const improveInputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (improveInputRef.current) {
      const textarea = improveInputRef.current;
      textarea.focus();
      textarea.setSelectionRange(textarea.value.length, textarea.value.length);
    }
  }, []);

  return (
    <div className="flex items-start gap-2 p-2">
      <Tooltip content={tConversations('editor.backToEditor')}>
        <Button onClick={onClose} variant="ghost" size="icon">
          <ChevronLeft className="size-4" />
        </Button>
      </Tooltip>
      <Textarea
        ref={improveInputRef}
        value={instruction}
        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
          onInstructionChange(e.target.value);
        }}
        placeholder={tConversations('suggestEditsPlaceholder')}
        className="text-muted-foreground h-auto min-h-[10rem] flex-1 resize-none border-0 bg-transparent p-2 text-sm outline-none focus-visible:ring-0 focus-visible:ring-offset-0"
        onKeyDown={(e: React.KeyboardEvent<HTMLTextAreaElement>) => {
          if (
            e.key === 'Enter' &&
            !e.shiftKey &&
            instruction.trim() &&
            !isImproving
          ) {
            e.preventDefault();
            onSubmit();
          }
        }}
      />
    </div>
  );
});
