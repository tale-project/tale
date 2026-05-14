'use client';

import { Button } from '@tale/ui/button';
import { Filter } from 'lucide-react';
import { useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Popover } from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

interface CategoryFilterPopoverProps {
  categories: string[];
  selectedCategories: string[];
  onSelectedCategoriesChange: (categories: string[]) => void;
}

export function CategoryFilterPopover({
  categories,
  selectedCategories,
  onSelectedCategoriesChange,
}: CategoryFilterPopoverProps) {
  const { t } = useT('prompts');
  const [open, setOpen] = useState(false);

  if (categories.length === 0) return null;

  const toggleCategory = (category: string) => {
    if (selectedCategories.includes(category)) {
      onSelectedCategoriesChange(
        selectedCategories.filter((c) => c !== category),
      );
    } else {
      onSelectedCategoriesChange([...selectedCategories, category]);
    }
  };

  return (
    <Popover
      trigger={
        <Button
          variant="secondary"
          aria-label={t('categoryFilter.title')}
          className="shrink-0 px-3"
        >
          <Filter className="size-4" />
        </Button>
      }
      align="end"
      contentClassName="w-[180px] p-1.5"
      modal
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-muted-foreground px-3 py-1.5 text-[11px] font-medium">
        {t('categoryFilter.title')}
      </p>
      <div className="flex flex-col">
        {categories.map((category) => (
          <label
            key={category}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          >
            <Checkbox
              checked={selectedCategories.includes(category)}
              onCheckedChange={() => toggleCategory(category)}
              className="size-4"
            />
            <span
              className={
                selectedCategories.includes(category)
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }
            >
              {category}
            </span>
          </label>
        ))}
      </div>
    </Popover>
  );
}
