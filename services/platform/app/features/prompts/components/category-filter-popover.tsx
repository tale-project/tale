'use client';

import { Button } from '@tale/ui/button';
import { Filter } from 'lucide-react';
import { useState } from 'react';

import { Checkbox } from '@/app/components/ui/forms/checkbox';
import { Popover } from '@/app/components/ui/overlays/popover';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';

interface FacetCategory {
  _id: Id<'promptCategories'>;
  name: string;
  scope: 'global' | 'team' | 'personal';
  teamId?: string;
}

interface CategoryFilterPopoverProps {
  /** Structured categories from `listPromptFacets`. */
  categories: FacetCategory[];
  /**
   * Legacy free-form category strings still present on unmigrated rows.
   * Empty (or nearly so) after the lazy migration runs against every
   * row; removed by the future cleanup migration.
   */
  legacyCategories: string[];
  selectedIds: Id<'promptCategories'>[];
  selectedLegacy: string[];
  onSelectedIdsChange: (ids: Id<'promptCategories'>[]) => void;
  onSelectedLegacyChange: (names: string[]) => void;
}

export function CategoryFilterPopover({
  categories,
  legacyCategories,
  selectedIds,
  selectedLegacy,
  onSelectedIdsChange,
  onSelectedLegacyChange,
}: CategoryFilterPopoverProps) {
  const { t } = useT('prompts');
  const [open, setOpen] = useState(false);

  if (categories.length === 0 && legacyCategories.length === 0) return null;

  const toggleId = (id: Id<'promptCategories'>) => {
    if (selectedIds.includes(id)) {
      onSelectedIdsChange(selectedIds.filter((x) => x !== id));
    } else {
      onSelectedIdsChange([...selectedIds, id]);
    }
  };
  const toggleLegacy = (name: string) => {
    if (selectedLegacy.includes(name)) {
      onSelectedLegacyChange(selectedLegacy.filter((x) => x !== name));
    } else {
      onSelectedLegacyChange([...selectedLegacy, name]);
    }
  };

  const activeCount = selectedIds.length + selectedLegacy.length;
  const triggerLabel =
    activeCount > 0
      ? t('categoryFilter.titleWithCount', { count: String(activeCount) })
      : t('categoryFilter.title');

  return (
    <Popover
      trigger={
        <Button
          variant="secondary"
          aria-label={triggerLabel}
          className="relative shrink-0 px-3"
        >
          <Filter className="size-4" />
          {activeCount > 0 && (
            <span
              aria-hidden="true"
              className="bg-primary text-primary-foreground absolute -top-1 -right-1 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] font-medium"
            >
              {activeCount}
            </span>
          )}
        </Button>
      }
      align="end"
      contentClassName="w-[220px] p-1.5"
      modal
      open={open}
      onOpenChange={setOpen}
    >
      <p className="text-muted-foreground px-3 py-1.5 text-[11px] font-medium">
        {t('categoryFilter.title')}
      </p>
      <div className="flex flex-col">
        {categories.map((category) => {
          const checked = selectedIds.includes(category._id);
          return (
            <label
              key={category._id}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleId(category._id)}
                className="size-4"
              />
              <span
                className={
                  checked ? 'text-foreground' : 'text-muted-foreground'
                }
              >
                {category.name}
              </span>
              <span className="text-muted-foreground ml-auto text-[10px] tracking-wide uppercase">
                {t(`categories.scopeGroup.${category.scope}`)}
              </span>
            </label>
          );
        })}
        {legacyCategories.length > 0 && categories.length > 0 && (
          <div className="border-border my-1 border-t" />
        )}
        {legacyCategories.map((name) => {
          const checked = selectedLegacy.includes(name);
          return (
            <label
              key={`legacy:${name}`}
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] transition-colors"
            >
              <Checkbox
                checked={checked}
                onCheckedChange={() => toggleLegacy(name)}
                className="size-4"
              />
              <span
                className={
                  checked ? 'text-foreground' : 'text-muted-foreground'
                }
              >
                {name}
              </span>
            </label>
          );
        })}
      </div>
    </Popover>
  );
}
