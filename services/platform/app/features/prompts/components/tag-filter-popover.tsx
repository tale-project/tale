'use client';

import { Button } from '@tale/ui/button';
import { Tag } from 'lucide-react';
import { useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Popover } from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

interface TagFilterPopoverProps {
  tags: string[];
  selectedTags: string[];
  onSelectedTagsChange: (tags: string[]) => void;
}

export function TagFilterPopover({
  tags,
  selectedTags,
  onSelectedTagsChange,
}: TagFilterPopoverProps) {
  const { t } = useT('prompts');
  const [open, setOpen] = useState(false);

  if (tags.length === 0) return null;

  const toggleTag = (tag: string) => {
    if (selectedTags.includes(tag)) {
      onSelectedTagsChange(selectedTags.filter((c) => c !== tag));
    } else {
      onSelectedTagsChange([...selectedTags, tag]);
    }
  };

  return (
    <Popover
      trigger={
        <Button
          variant="secondary"
          aria-label={t('tagFilter.title')}
          className="shrink-0 px-3"
        >
          <Tag className="size-4" />
        </Button>
      }
      align="end"
      contentClassName="w-[180px] p-1.5"
      modal
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-muted-foreground px-3 py-1.5 text-[11px] font-medium">
        {t('tagFilter.title')}
      </p>
      <div className="flex flex-col">
        {tags.map((tag) => (
          <label
            key={tag}
            className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
          >
            <Checkbox
              checked={selectedTags.includes(tag)}
              onCheckedChange={() => toggleTag(tag)}
              className="size-4"
            />
            <span
              className={
                selectedTags.includes(tag)
                  ? 'text-foreground'
                  : 'text-muted-foreground'
              }
            >
              {tag}
            </span>
          </label>
        ))}
      </div>
    </Popover>
  );
}
