'use client';

import { Plus } from 'lucide-react';
import { useCallback, useState } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { Button } from '@/app/components/ui/primitives/button';
import { useT } from '@/lib/i18n/client';

interface AddCategoryPopoverProps {
  existingCategories: string[];
  onAddCategory: (category: string) => void;
  /** Custom trigger element. Falls back to a default ghost button. */
  trigger?: React.ReactNode;
}

export function AddCategoryPopover({
  existingCategories,
  onAddCategory,
  trigger: customTrigger,
}: AddCategoryPopoverProps) {
  const { t } = useT('prompts');
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');

  const trimmed = value.trim();
  const isDuplicate = existingCategories.some(
    (c) => c.toLowerCase() === trimmed.toLowerCase(),
  );
  const isValid = trimmed.length > 0 && !isDuplicate;

  const handleAdd = useCallback(() => {
    if (!isValid) return;
    onAddCategory(trimmed);
    setValue('');
    setOpen(false);
  }, [isValid, trimmed, onAddCategory]);

  const handleCancel = useCallback(() => {
    setValue('');
    setOpen(false);
  }, []);

  return (
    <Popover
      trigger={
        customTrigger ?? (
          <button
            type="button"
            className="text-muted-foreground border-muted-foreground bg-muted hover:bg-accent flex items-center gap-1 rounded-full border-[1.5px] px-2.5 py-1.5 text-[13px] font-medium transition-colors"
          >
            <Plus className="size-3.5" />
            {t('addCategory.add')}
          </button>
        )
      }
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setValue('');
      }}
      align="start"
      contentClassName="w-[220px] rounded-xl p-3"
      modal
    >
      <div className="flex flex-col gap-2.5">
        <input
          type="text"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              handleAdd();
            } else if (e.key === 'Escape') {
              e.preventDefault();
              handleCancel();
            }
          }}
          placeholder={t('addCategory.inputPlaceholder')}
          className="bg-background border-input text-foreground placeholder:text-muted-foreground rounded-lg border px-3 py-2 text-[13px] outline-none focus:ring-2 focus:ring-blue-500"
          autoFocus
        />
        <div className="flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={handleCancel}
            className="text-muted-foreground text-[13px] font-medium hover:underline"
          >
            {t('addCategory.cancel')}
          </button>
          <Button
            size="sm"
            onClick={handleAdd}
            disabled={!isValid}
            className="h-auto rounded-md px-3 py-1.5 text-[13px]"
          >
            {t('addCategory.add')}
          </Button>
        </div>
      </div>
    </Popover>
  );
}
